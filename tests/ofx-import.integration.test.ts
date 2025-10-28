import { describe, before, after, beforeEach, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import bcrypt from "bcrypt";
import crypto from "crypto";

import { registerRoutes } from "../server/routes";
import { MemStorage, setStorageProvider, type IStorage } from "../server/storage";
import type { Client, OFXImport, User } from "@shared/schema";
import { maskPIIValue } from "@shared/utils";
import * as metrics from "../server/observability/metrics";

const MASTER_EMAIL = "master@example.com";
const MASTER_PASSWORD = "master-secret";
const MASTER_USER_ID = "user-master-1";
const CLIENT_ID = "client-1";
const OTHER_CLIENT_ID = "client-2";
const ORGANIZATION_ID = "org-1";

const SAMPLE_ACCOUNT_ID = "123456";
const SECOND_ACCOUNT_ID = "789012";
const SAMPLE_OFX = `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:UTF-8\nCHARSET:1252\nCOMPRESSION:NONE\nOLDFILEUID:NONE\nNEWFILEUID:NONE\n\n<OFX>\n  <SIGNONMSGSRSV1>\n    <SONRS>\n      <STATUS>\n        <CODE>0\n        <SEVERITY>INFO\n      </STATUS>\n      <DTSERVER>20240131120000\n      <LANGUAGE>POR\n    </SONRS>\n  </SIGNONMSGSRSV1>\n  <BANKMSGSRSV1>\n    <STMTTRNRS>\n      <TRNUID>1001\n      <STATUS>\n        <CODE>0\n        <SEVERITY>INFO\n      </STATUS>\n      <STMTRS>\n        <CURDEF>BRL\n        <BANKACCTFROM>\n          <BANKID>341\n          <ACCTID>${SAMPLE_ACCOUNT_ID}\n          <ACCTTYPE>CHECKING\n        </BANKACCTFROM>\n        <BANKTRANLIST>\n          <DTSTART>20240101000000\n          <DTEND>20240131235959\n          <STMTTRN>\n            <TRNTYPE>CREDIT\n            <DTPOSTED>20240105\n            <TRNAMT>1000.00\n            <FITID>ABC123\n            <NAME>Venda 1\n          </STMTTRN>\n          <STMTTRN>\n            <TRNTYPE>DEBIT\n            <DTPOSTED>20240110\n            <TRNAMT>200.00\n            <FITID>DEF456\n            <NAME>Pagamento Fornecedor\n          </STMTTRN>\n        </BANKTRANLIST>\n        <LEDGERBAL>\n          <BALAMT>800.00\n          <DTASOF>20240131235959\n        </LEDGERBAL>\n      </STMTRS>\n    </STMTTRNRS>\n  </BANKMSGSRSV1>\n</OFX>\n`;

const SAMPLE_OFX_OTHER_ACCOUNT = `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:UTF-8\nCHARSET:1252\nCOMPRESSION:NONE\nOLDFILEUID:NONE\nNEWFILEUID:NONE\n\n<OFX>\n  <BANKMSGSRSV1>\n    <STMTTRNRS>\n      <TRNUID>2001\n      <STATUS>\n        <CODE>0\n        <SEVERITY>INFO\n      </STATUS>\n      <STMTRS>\n        <CURDEF>BRL\n        <BANKACCTFROM>\n          <BANKID>341\n          <ACCTID>${SECOND_ACCOUNT_ID}\n          <ACCTTYPE>CHECKING\n        </BANKACCTFROM>\n        <BANKTRANLIST>\n          <DTSTART>20240101000000\n          <DTEND>20240131235959\n          <STMTTRN>\n            <TRNTYPE>CREDIT\n            <DTPOSTED>20240106\n            <TRNAMT>900.00\n            <FITID>ABC123\n            <NAME>Venda Conta B\n          </STMTTRN>\n          <STMTTRN>\n            <TRNTYPE>DEBIT\n            <DTPOSTED>20240112\n            <TRNAMT>300.00\n            <FITID>DEF456\n            <NAME>Pagamento Conta B\n          </STMTTRN>\n        </BANKTRANLIST>\n        <LEDGERBAL>\n          <BALAMT>600.00\n          <DTASOF>20240131235959\n        </LEDGERBAL>\n      </STMTRS>\n    </STMTTRNRS>\n  </BANKMSGSRSV1>\n</OFX>\n`;

const MULTI_ACCOUNT_OFX = `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:UTF-8\nCHARSET:1252\nCOMPRESSION:NONE\nOLDFILEUID:NONE\nNEWFILEUID:NONE\n\n<OFX>\n  <BANKMSGSRSV1>\n    <STMTTRNRS>\n      <TRNUID>3001\n      <STATUS>\n        <CODE>0\n        <SEVERITY>INFO\n      </STATUS>\n      <STMTRS>\n        <CURDEF>BRL\n        <BANKACCTFROM>\n          <BANKID>001\n          <ACCTID>${SAMPLE_ACCOUNT_ID}\n        </BANKACCTFROM>\n        <BANKTRANLIST>\n          <DTSTART>20240201000000\n          <DTEND>20240228235959\n          <STMTTRN>\n            <TRNTYPE>CREDIT\n            <DTPOSTED>20240205\n            <TRNAMT>500.00\n            <FITID>MULTI-A-1\n            <NAME>Recebimento Conta A\n          </STMTTRN>\n        </BANKTRANLIST>\n        <LEDGERBAL>\n          <BALAMT>500.00\n        </LEDGERBAL>\n      </STMTRS>\n    </STMTTRNRS>\n    <STMTTRNRS>\n      <TRNUID>3002\n      <STATUS>\n        <CODE>0\n        <SEVERITY>INFO\n      </STATUS>\n      <STMTRS>\n        <CURDEF>BRL\n        <BANKACCTFROM>\n          <BANKID>001\n          <ACCTID>${SECOND_ACCOUNT_ID}\n        </BANKACCTFROM>\n        <BANKTRANLIST>\n          <DTSTART>20240201000000\n          <DTEND>20240228235959\n          <STMTTRN>\n            <TRNTYPE>DEBIT\n            <DTPOSTED>20240210\n            <TRNAMT>200.00\n            <FITID>MULTI-B-1\n            <NAME>Despesa Conta B\n          </STMTTRN>\n        </BANKTRANLIST>\n        <LEDGERBAL>\n          <BALAMT>300.00\n        </LEDGERBAL>\n      </STMTRS>\n    </STMTTRNRS>\n  </BANKMSGSRSV1>\n</OFX>\n`;

const UNKNOWN_LABEL = "unknown";

function maskBankNameLabel(raw: string) {
  if (!raw || raw.toLowerCase() === UNKNOWN_LABEL) {
    return UNKNOWN_LABEL;
  }
  const masked = maskPIIValue("bankName", raw);
  return typeof masked === "string" ? masked : String(masked);
}

const METRICS_SAMPLE_ACCOUNT_ID = "7890";
const METRICS_SAMPLE_BANK_ID = "001";
const METRICS_MASKED_BANK_NAME = maskBankNameLabel(METRICS_SAMPLE_BANK_ID);

function getDurationCount(
  snapshot: any[],
  status: "success" | "error",
  bankAccountId: string,
  bankName: string
) {
  const metric = snapshot.find(entry => entry.name === "ofx_ingestion_duration_seconds");
  const countEntry = metric?.values?.find((value: any) => {
    const labels = value.labels ?? {};
    return (
      labels.clientId === CLIENT_ID &&
      labels.bankAccountId === bankAccountId &&
      labels.bankName === bankName &&
      labels.status === status &&
      labels.le === "+Inf"
    );
  });
  return countEntry?.value ?? 0;
}

function getErrorCount(snapshot: any[], stage: string, bankAccountId: string, bankName: string) {
  const metric = snapshot.find(entry => entry.name === "ofx_ingestion_errors_total");
  const entry = metric?.values?.find(
    (value: any) =>
      value.labels?.clientId === CLIENT_ID &&
      value.labels?.bankAccountId === bankAccountId &&
      value.labels?.bankName === bankName &&
      value.labels?.stage === stage
  );
  return entry?.value ?? 0;
}

async function seedStorage(storage: IStorage) {
  const passwordHash = await bcrypt.hash(MASTER_PASSWORD, 10);
  const masterUser: User = {
    userId: MASTER_USER_ID,
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

    const sampleBuffer = Buffer.from(SAMPLE_OFX, "utf8");

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
    const importRecord = await currentStorage.getOFXImport(CLIENT_ID, SAMPLE_ACCOUNT_ID, fileHash);
    assert.ok(importRecord, "ofx import record should be stored");
    assert.equal(importRecord?.transactionCount, 2);
    assert.equal(importRecord?.reconciliation?.accounts[0]?.computedClosingBalance, 800);
    assert.equal(importRecord?.statementStart, "01/01/2024");
    assert.equal(importRecord?.statementEnd, "31/01/2024");

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

  it("imports OFX files when clientId is provided in the multipart body", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_EMAIL, password: MASTER_PASSWORD })
      .expect(200);

    const sampleBuffer = Buffer.from(SAMPLE_OFX, "utf8");

    const response = await agent
      .post("/api/pj/import/ofx")
      .field("clientId", CLIENT_ID)
      .attach("ofx", sampleBuffer, { filename: "extrato.ofx", contentType: "application/ofx" });

    assert.equal(response.status, 200);
    assert.equal(response.body.imported, 2);
    assert.equal(response.body.total, 2);
    assert.equal(response.body.alreadyImported, false);

    const storedTransactions = await currentStorage.getBankTransactions(CLIENT_ID);
    assert.equal(storedTransactions.length, 2);
  });

  it("imports identical OFX files for different bank accounts without deduping", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_EMAIL, password: MASTER_PASSWORD })
      .expect(200);

    const firstBuffer = Buffer.from(SAMPLE_OFX, "utf8");
    const secondBuffer = Buffer.from(SAMPLE_OFX_OTHER_ACCOUNT, "utf8");
    const secondHash = crypto.createHash("sha256").update(secondBuffer).digest("hex");

    const firstImport = await agent
      .post(`/api/pj/import/ofx?clientId=${CLIENT_ID}`)
      .attach("ofx", firstBuffer, { filename: "acc-a.ofx", contentType: "application/ofx" });

    assert.equal(firstImport.status, 200);
    assert.equal(firstImport.body.imported, 2);

    const secondImport = await agent
      .post(`/api/pj/import/ofx?clientId=${CLIENT_ID}`)
      .attach("ofx", secondBuffer, { filename: "acc-b.ofx", contentType: "application/ofx" });

    assert.equal(secondImport.status, 200);
    assert.equal(secondImport.body.imported, 2);
    assert.equal(secondImport.body.alreadyImported, false);

    const accountATxs = await currentStorage.getBankTransactions(CLIENT_ID, SAMPLE_ACCOUNT_ID);
    const accountBTxs = await currentStorage.getBankTransactions(CLIENT_ID, SECOND_ACCOUNT_ID);
    assert.equal(accountATxs.length, 2);
    assert.equal(accountBTxs.length, 2);

    const accountBImport = await currentStorage.getOFXImport(CLIENT_ID, SECOND_ACCOUNT_ID, secondHash);
    assert.ok(accountBImport);
    assert.equal(accountBImport?.transactionCount, 2);
  });

  it("allows identical OFX files to be imported by different clients", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_EMAIL, password: MASTER_PASSWORD })
      .expect(200);

    const sampleBuffer = Buffer.from(SAMPLE_OFX, "utf8");
    const fileHash = crypto.createHash("sha256").update(sampleBuffer).digest("hex");

    const firstImport = await agent
      .post(`/api/pj/import/ofx?clientId=${CLIENT_ID}`)
      .attach("ofx", sampleBuffer, { filename: "extrato.ofx", contentType: "application/ofx" });

    assert.equal(firstImport.status, 200);
    assert.equal(firstImport.body.alreadyImported, false);

    const secondClient: Client = {
      clientId: OTHER_CLIENT_ID,
      name: "Empresa Filial",
      type: "PJ",
      email: "filial@example.com",
      organizationId: ORGANIZATION_ID,
      consultantId: null,
      masterId: MASTER_USER_ID,
    };

    await currentStorage.upsertClient(secondClient);
    await currentStorage.updateUser(MASTER_USER_ID, {
      clientIds: [CLIENT_ID, OTHER_CLIENT_ID],
      managedClientIds: [CLIENT_ID, OTHER_CLIENT_ID],
    });

    const secondImport = await agent
      .post(`/api/pj/import/ofx?clientId=${OTHER_CLIENT_ID}`)
      .attach("ofx", sampleBuffer, { filename: "extrato.ofx", contentType: "application/ofx" });

    assert.equal(secondImport.status, 200);
    assert.equal(secondImport.body.alreadyImported, false);

    const originalClientImport = await currentStorage.getOFXImport(CLIENT_ID, SAMPLE_ACCOUNT_ID, fileHash);
    const secondClientImport = await currentStorage.getOFXImport(OTHER_CLIENT_ID, SAMPLE_ACCOUNT_ID, fileHash);

    assert.ok(originalClientImport, "original client import should exist");
    assert.ok(secondClientImport, "second client import should exist");
    assert.equal(originalClientImport?.clientId, CLIENT_ID);
    assert.equal(secondClientImport?.clientId, OTHER_CLIENT_ID);
  });

  it("stores multi-account OFX imports per bank account and remains idempotent", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_EMAIL, password: MASTER_PASSWORD })
      .expect(200);

    const multiBuffer = Buffer.from(MULTI_ACCOUNT_OFX, "utf8");
    const multiHash = crypto.createHash("sha256").update(multiBuffer).digest("hex");

    const firstImport = await agent
      .post(`/api/pj/import/ofx?clientId=${CLIENT_ID}`)
      .attach("ofx", multiBuffer, { filename: "multi.ofx", contentType: "application/ofx" });

    assert.equal(firstImport.status, 200);
    assert.equal(firstImport.body.imported, 2);
    assert.equal(firstImport.body.reconciliation.accounts.length, 2);

    const accountATxs = await currentStorage.getBankTransactions(CLIENT_ID, SAMPLE_ACCOUNT_ID);
    const accountBTxs = await currentStorage.getBankTransactions(CLIENT_ID, SECOND_ACCOUNT_ID);
    assert.equal(accountATxs.length, 1);
    assert.equal(accountBTxs.length, 1);

    const accountAImport = await currentStorage.getOFXImport(CLIENT_ID, SAMPLE_ACCOUNT_ID, multiHash);
    const accountBImport = await currentStorage.getOFXImport(CLIENT_ID, SECOND_ACCOUNT_ID, multiHash);
    assert.ok(accountAImport);
    assert.ok(accountBImport);
    assert.equal(accountAImport?.transactionCount, 1);
    assert.equal(accountBImport?.transactionCount, 1);

    const secondImport = await agent
      .post(`/api/pj/import/ofx?clientId=${CLIENT_ID}`)
      .attach("ofx", multiBuffer, { filename: "multi.ofx", contentType: "application/ofx" });

    assert.equal(secondImport.status, 200);
    assert.equal(secondImport.body.imported, 0);
    assert.equal(secondImport.body.deduped, 2);
    assert.equal(secondImport.body.alreadyImported, true);
    assert.equal(secondImport.body.reconciliation.accounts.length, 2);

    const accountATxsAfter = await currentStorage.getBankTransactions(CLIENT_ID, SAMPLE_ACCOUNT_ID);
    const accountBTxsAfter = await currentStorage.getBankTransactions(CLIENT_ID, SECOND_ACCOUNT_ID);
    assert.equal(accountATxsAfter.length, 1);
    assert.equal(accountBTxsAfter.length, 1);
  });

  it("migrates legacy OFX import entries keyed only by file hash", async () => {
    const legacyHash = crypto.createHash("sha256").update("legacy-ofx").digest("hex");
    const legacyImport: OFXImport = {
      fileHash: legacyHash,
      clientId: CLIENT_ID,
      bankAccountId: SAMPLE_ACCOUNT_ID,
      importedAt: new Date().toISOString(),
      transactionCount: 3,
    };

    (currentStorage as any).ofxImports.set(legacyHash, legacyImport);

    const migrated = await currentStorage.getOFXImport(CLIENT_ID, SAMPLE_ACCOUNT_ID, legacyHash);
    assert.ok(migrated, "legacy import should be retrievable after migration");
    assert.equal(migrated?.clientId, CLIENT_ID);

    const normalizedKey = `ofxImport:${CLIENT_ID}:${SAMPLE_ACCOUNT_ID}:${legacyHash}`;
    assert.ok((currentStorage as any).ofxImports.has(normalizedKey), "legacy key should be normalized");
    assert.equal((currentStorage as any).ofxImports.has(legacyHash), false, "legacy key should be removed");
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
    const beforeSuccessCount = getDurationCount(
      beforeSnapshot,
      "success",
      METRICS_SAMPLE_ACCOUNT_ID,
      METRICS_MASKED_BANK_NAME
    );
    const beforeErrorCount = getDurationCount(
      beforeSnapshot,
      "error",
      METRICS_SAMPLE_ACCOUNT_ID,
      METRICS_MASKED_BANK_NAME
    );
    const beforeErrorCounter = getErrorCount(beforeSnapshot, "parse", UNKNOWN_LABEL, UNKNOWN_LABEL);

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

    const afterSuccessCount = getDurationCount(
      afterSnapshot,
      "success",
      METRICS_SAMPLE_ACCOUNT_ID,
      METRICS_MASKED_BANK_NAME
    );
    const afterErrorCount = getDurationCount(
      afterSnapshot,
      "error",
      METRICS_SAMPLE_ACCOUNT_ID,
      METRICS_MASKED_BANK_NAME
    );
    const afterErrorCounter = getErrorCount(afterSnapshot, "parse", UNKNOWN_LABEL, UNKNOWN_LABEL);

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
    const beforeSuccessCount = getDurationCount(
      beforeSnapshot,
      "success",
      UNKNOWN_LABEL,
      UNKNOWN_LABEL
    );
    const beforeErrorCount = getDurationCount(
      beforeSnapshot,
      "error",
      UNKNOWN_LABEL,
      UNKNOWN_LABEL
    );
    const beforeParseErrors = getErrorCount(beforeSnapshot, "parse", UNKNOWN_LABEL, UNKNOWN_LABEL);

    const response = await agent
      .post(`/api/pj/import/ofx?clientId=${CLIENT_ID}`)
      .attach("ofx", Buffer.from(invalidOfx, "utf8"), {
        filename: "metrics-error.ofx",
        contentType: "application/ofx",
      });

    assert.equal(response.status, 500);

    await metrics.metricsRegistry.metrics();
    const afterSnapshot = await metrics.metricsRegistry.getMetricsAsJSON();

    const afterSuccessCount = getDurationCount(
      afterSnapshot,
      "success",
      UNKNOWN_LABEL,
      UNKNOWN_LABEL
    );
    const afterErrorCount = getDurationCount(
      afterSnapshot,
      "error",
      UNKNOWN_LABEL,
      UNKNOWN_LABEL
    );
    const afterParseErrors = getErrorCount(afterSnapshot, "parse", UNKNOWN_LABEL, UNKNOWN_LABEL);

    assert.equal(afterErrorCount, beforeErrorCount + 1);
    assert.equal(afterSuccessCount, beforeSuccessCount);
    assert.equal(afterParseErrors, beforeParseErrors + 1);
  });
});
