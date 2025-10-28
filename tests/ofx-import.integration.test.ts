import { describe, before, after, beforeEach, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import bcrypt from "bcrypt";
import crypto from "crypto";

import { registerRoutes } from "../server/routes";
import { MemStorage, setStorageProvider, type IStorage } from "../server/storage";
import type { Client, User } from "@shared/schema";
import * as metrics from "../server/observability/metrics";

const MASTER_EMAIL = "master@example.com";
const MASTER_PASSWORD = "master-secret";
const CLIENT_ID = "client-1";
const ORGANIZATION_ID = "org-1";

function getDurationCount(snapshot: any[], status: "success" | "error") {
  const metric = snapshot.find(entry => entry.name === "ofx_ingestion_duration_seconds");
  const countEntry = metric?.values?.find((value: any) => {
    const labels = value.labels ?? {};
    return (
      labels.clientId === CLIENT_ID &&
      labels.status === status &&
      labels.le === "+Inf"
    );
  });
  return countEntry?.value ?? 0;
}

function getErrorCount(snapshot: any[], stage: string) {
  const metric = snapshot.find(entry => entry.name === "ofx_ingestion_errors_total");
  const entry = metric?.values?.find(
    (value: any) =>
      value.labels?.clientId === CLIENT_ID &&
      value.labels?.stage === stage
  );
  return entry?.value ?? 0;
}

async function seedStorage(storage: IStorage) {
  const passwordHash = await bcrypt.hash(MASTER_PASSWORD, 10);
  const masterUser: User = {
    userId: "user-master-1",
    email: MASTER_EMAIL,
    passwordHash,
    role: "master",
    name: "Master Org",
    organizationId: ORGANIZATION_ID,
    clientIds: [CLIENT_ID],
    managedConsultantIds: [],
    managedClientIds: [CLIENT_ID],
  };

  const client: Client = {
    clientId: CLIENT_ID,
    name: "Empresa Teste",
    type: "PJ",
    email: "empresa@example.com",
    organizationId: ORGANIZATION_ID,
    consultantId: null,
    masterId: masterUser.userId,
  };

  await storage.createUser(masterUser);
  await storage.upsertClient(client);
}

describe("OFX ingestion robustness", () => {
  let appServer: import("http").Server;
  let currentStorage: IStorage;

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use(
      session({
        secret: "test-secret",
        resave: false,
        saveUninitialized: false,
      })
    );

    currentStorage = new MemStorage();
    setStorageProvider(currentStorage);
    await seedStorage(currentStorage);

    appServer = await registerRoutes(app);
  });

  after(async () => {
    if (appServer?.listening) {
      await new Promise<void>((resolve, reject) => {
        appServer.close(err => (err ? reject(err) : resolve()));
      });
    }
  });

  beforeEach(async () => {
    currentStorage = new MemStorage();
    setStorageProvider(currentStorage);
    await seedStorage(currentStorage);
  });

  it("imports OFX files idempotently and stores reconciliation summaries", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_EMAIL, password: MASTER_PASSWORD })
      .expect(200);

    const sampleOfx = `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:UTF-8\nCHARSET:1252\nCOMPRESSION:NONE\nOLDFILEUID:NONE\nNEWFILEUID:NONE\n\n<OFX>\n  <SIGNONMSGSRSV1>\n    <SONRS>\n      <STATUS>\n        <CODE>0\n        <SEVERITY>INFO\n      </STATUS>\n      <DTSERVER>20240131120000\n      <LANGUAGE>POR\n    </SONRS>\n  </SIGNONMSGSRSV1>\n  <BANKMSGSRSV1>\n    <STMTTRNRS>\n      <TRNUID>1001\n      <STATUS>\n        <CODE>0\n        <SEVERITY>INFO\n      </STATUS>\n      <STMTRS>\n        <CURDEF>BRL\n        <BANKACCTFROM>\n          <BANKID>341\n          <ACCTID>123456\n          <ACCTTYPE>CHECKING\n        </BANKACCTFROM>\n        <BANKTRANLIST>\n          <DTSTART>20240101000000\n          <DTEND>20240131235959\n          <STMTTRN>\n            <TRNTYPE>CREDIT\n            <DTPOSTED>20240105\n            <TRNAMT>1000.00\n            <FITID>ABC123\n            <NAME>Venda 1\n          </STMTTRN>\n          <STMTTRN>\n            <TRNTYPE>DEBIT\n            <DTPOSTED>20240110\n            <TRNAMT>200.00\n            <FITID>DEF456\n            <NAME>Pagamento Fornecedor\n          </STMTTRN>\n        </BANKTRANLIST>\n        <LEDGERBAL>\n          <BALAMT>800.00\n          <DTASOF>20240131235959\n        </LEDGERBAL>\n      </STMTRS>\n    </STMTTRNRS>\n  </BANKMSGSRSV1>\n</OFX>\n`;

    const sampleBuffer = Buffer.from(sampleOfx, "utf8");

    const response = await agent
      .post(`/api/pj/import/ofx?clientId=${CLIENT_ID}`)
      .attach("ofx", sampleBuffer, { filename: "extrato.ofx", contentType: "application/ofx" });

    assert.equal(response.status, 200);

    assert.equal(response.body.imported, 2);
    assert.equal(response.body.total, 2);
    assert.equal(response.body.deduped, 0);
    assert.equal(response.body.alreadyImported, false);
    assert.ok(Array.isArray(response.body.reconciliation.accounts));
    assert.equal(response.body.reconciliation.accounts[0].ledgerClosingBalance, 800);
    assert.equal(response.body.reconciliation.accounts[0].totalCredits, 1000);
    assert.equal(response.body.reconciliation.accounts[0].totalDebits, 200);
    assert.ok(
      response.body.reconciliation.warnings.some((msg: string) =>
        msg.includes("Sinal ajustado automaticamente")
      ),
      "expected debit sign warning"
    );

    const storedTransactions = await currentStorage.getBankTransactions(CLIENT_ID);
    assert.equal(storedTransactions.length, 2);

    const fileHash = crypto.createHash("sha256").update(sampleBuffer).digest("hex");
    const importRecord = await currentStorage.getOFXImport(fileHash);
    assert.ok(importRecord, "ofx import record should be stored");
    assert.equal(importRecord?.transactionCount, 2);
    assert.equal(importRecord?.reconciliation?.accounts[0]?.computedClosingBalance, 800);

    const secondImport = await agent
      .post(`/api/pj/import/ofx?clientId=${CLIENT_ID}`)
      .attach("ofx", sampleBuffer, { filename: "extrato.ofx", contentType: "application/ofx" });

    assert.equal(secondImport.status, 200);

    assert.equal(secondImport.body.imported, 0);
    assert.equal(secondImport.body.deduped, 2);
    assert.equal(secondImport.body.alreadyImported, true);

    const storedAfterDedup = await currentStorage.getBankTransactions(CLIENT_ID);
    assert.equal(storedAfterDedup.length, 2, "re-import should not duplicate transactions");
  });

  it("reports reconciliation divergences above one cent", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_EMAIL, password: MASTER_PASSWORD })
      .expect(200);

    const mismatchOfx = `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:UTF-8\nCHARSET:1252\nCOMPRESSION:NONE\nOLDFILEUID:NONE\nNEWFILEUID:NONE\n\n<OFX>\n  <BANKMSGSRSV1>\n    <STMTTRNRS>\n      <TRNUID>2002\n      <STATUS>\n        <CODE>0\n        <SEVERITY>INFO\n      </STATUS>\n      <STMTRS>\n        <CURDEF>BRL\n        <BANKACCTFROM>\n          <BANKID>237\n          <ACCTID>654321\n        </BANKACCTFROM>\n        <BANKTRANLIST>\n          <DTSTART>20240201000000\n          <DTEND>20240228235959\n          <BALAMT>300.00\n          <STMTTRN>\n            <TRNTYPE>CREDIT\n            <DTPOSTED>20240205\n            <TRNAMT>1500.00\n            <FITID>XYZ789\n            <NAME>Pagamento Cliente\n          </STMTTRN>\n          <STMTTRN>\n            <TRNTYPE>DEBIT\n            <DTPOSTED>20240210\n            <TRNAMT>500.00\n            <FITID>XYZ790\n            <NAME>Fornecedor\n          </STMTTRN>\n        </BANKTRANLIST>\n        <LEDGERBAL>\n          <BALAMT>1200.00\n          <DTASOF>20240228235959\n        </LEDGERBAL>\n      </STMTRS>\n    </STMTTRNRS>\n  </BANKMSGSRSV1>\n</OFX>\n`;

    const mismatchResponse = await agent
      .post(`/api/pj/import/ofx?clientId=${CLIENT_ID}`)
      .attach("ofx", Buffer.from(mismatchOfx, "utf8"), {
        filename: "extrato-mismatch.ofx",
        contentType: "application/ofx",
      });

    assert.equal(mismatchResponse.status, 200);

    assert.equal(mismatchResponse.body.imported, 2);
    assert.equal(mismatchResponse.body.alreadyImported, false);
    assert.ok(
      mismatchResponse.body.reconciliation.warnings.some((msg: string) =>
        msg.includes("Divergência de R$")
      ),
      "expected divergence warning"
    );
  });

  it("records prometheus metrics on successful OFX imports", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_EMAIL, password: MASTER_PASSWORD })
      .expect(200);

    await metrics.metricsRegistry.metrics();
    const beforeSnapshot = await metrics.metricsRegistry.getMetricsAsJSON();
    const beforeSuccessCount = getDurationCount(beforeSnapshot, "success");
    const beforeErrorCount = getDurationCount(beforeSnapshot, "error");
    const beforeErrorCounter = getErrorCount(beforeSnapshot, "parse");

    const sampleOfx = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:UTF-8
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
  <BANKMSGSRSV1>
    <STMTTRNRS>
      <STATUS>
        <CODE>0
        <SEVERITY>INFO
      </STATUS>
      <STMTRS>
        <BANKACCTFROM>
          <BANKID>001
          <ACCTID>7890
        </BANKACCTFROM>
        <BANKTRANLIST>
          <DTSTART>20240101000000
          <DTEND>20240131235959
          <STMTTRN>
            <TRNTYPE>CREDIT
            <DTPOSTED>20240102
            <TRNAMT>500.00
            <FITID>METRIC1
            <NAME>Recebimento
          </STMTTRN>
        </BANKTRANLIST>
        <LEDGERBAL>
          <BALAMT>500.00
        </LEDGERBAL>
      </STMTRS>
    </STMTTRNRS>
  </BANKMSGSRSV1>
</OFX>
`;

    const response = await agent
      .post(`/api/pj/import/ofx?clientId=${CLIENT_ID}`)
      .attach("ofx", Buffer.from(sampleOfx, "utf8"), {
        filename: "metrics-success.ofx",
        contentType: "application/ofx",
      });

    assert.equal(response.status, 200);

    await metrics.metricsRegistry.metrics();
    const afterSnapshot = await metrics.metricsRegistry.getMetricsAsJSON();

    const afterSuccessCount = getDurationCount(afterSnapshot, "success");
    const afterErrorCount = getDurationCount(afterSnapshot, "error");
    const afterErrorCounter = getErrorCount(afterSnapshot, "parse");

    assert.equal(afterSuccessCount, beforeSuccessCount + 1);
    assert.equal(afterErrorCount, beforeErrorCount);
    assert.equal(afterErrorCounter, beforeErrorCounter);
  });

  it("records prometheus metrics on failed OFX imports", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_EMAIL, password: MASTER_PASSWORD })
      .expect(200);

    const invalidOfx = "INVALID CONTENT";

    await metrics.metricsRegistry.metrics();
    const beforeSnapshot = await metrics.metricsRegistry.getMetricsAsJSON();
    const beforeSuccessCount = getDurationCount(beforeSnapshot, "success");
    const beforeErrorCount = getDurationCount(beforeSnapshot, "error");
    const beforeParseErrors = getErrorCount(beforeSnapshot, "parse");

    const response = await agent
      .post(`/api/pj/import/ofx?clientId=${CLIENT_ID}`)
      .attach("ofx", Buffer.from(invalidOfx, "utf8"), {
        filename: "metrics-error.ofx",
        contentType: "application/ofx",
      });

    assert.equal(response.status, 500);

    await metrics.metricsRegistry.metrics();
    const afterSnapshot = await metrics.metricsRegistry.getMetricsAsJSON();

    const afterSuccessCount = getDurationCount(afterSnapshot, "success");
    const afterErrorCount = getDurationCount(afterSnapshot, "error");
    const afterParseErrors = getErrorCount(afterSnapshot, "parse");

    assert.equal(afterErrorCount, beforeErrorCount + 1);
    assert.equal(afterSuccessCount, beforeSuccessCount);
    assert.equal(afterParseErrors, beforeParseErrors + 1);
  });
});
