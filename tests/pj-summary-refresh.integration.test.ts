import { describe, before, after, beforeEach, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import bcrypt from "bcrypt";

import { registerRoutes } from "../server/routes";
import { MemStorage, setStorageProvider, type IStorage } from "../server/storage";
import type {
  BankAccount,
  BankTransaction,
  Client,
  PjClientCategory,
  SaleLeg,
  User,
} from "@shared/schema";

const ORGANIZATION_ID = "snapshot-org";
const CLIENT_ID = "snapshot-client";
const BANK_ACCOUNT_ID = "snapshot-account";
const MASTER_EMAIL = "refresh-master@pj.example.com";
const MASTER_PASSWORD = "refresh-secret";

const SIMPLE_OFX = `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:UTF-8\nCHARSET:1252\nCOMPRESSION:NONE\nOLDFILEUID:NONE\nNEWFILEUID:NONE\n\n<OFX>\n  <BANKMSGSRSV1>\n    <STMTTRNRS>\n      <TRNUID>1\n      <STATUS>\n        <CODE>0\n        <SEVERITY>INFO\n      </STATUS>\n      <STMTRS>\n        <CURDEF>BRL\n        <BANKACCTFROM>\n          <BANKID>001\n          <ACCTID>${BANK_ACCOUNT_ID}\n        </BANKACCTFROM>\n        <BANKTRANLIST>\n          <DTSTART>20240101000000\n          <DTEND>20240131000000\n          <STMTTRN>\n            <TRNTYPE>CREDIT\n            <DTPOSTED>20240105\n            <TRNAMT>1000.00\n            <FITID>1\n            <NAME>Receita\n          </STMTTRN>\n          <STMTTRN>\n            <TRNTYPE>DEBIT\n            <DTPOSTED>20240110\n            <TRNAMT>200.00\n            <FITID>2\n            <NAME>Despesa\n          </STMTTRN>\n        </BANKTRANLIST>\n      </STMTRS>\n    </STMTTRNRS>\n  </BANKMSGSRSV1>\n</OFX>\n`;

async function seedBase(storage: IStorage) {
  const passwordHash = await bcrypt.hash(MASTER_PASSWORD, 10);
  const master: User = {
    userId: "refresh-master-id",
    email: MASTER_EMAIL,
    passwordHash,
    role: "master",
    name: "Refresh Master",
    organizationId: ORGANIZATION_ID,
    clientIds: [CLIENT_ID],
    managedConsultantIds: [],
    managedClientIds: [CLIENT_ID],
  };

  const client: Client = {
    clientId: CLIENT_ID,
    name: "Refresh Client PJ",
    type: "PJ",
    email: "refresh-client@pj.example.com",
    organizationId: ORGANIZATION_ID,
    consultantId: null,
    masterId: master.userId,
  };

  const bankAccount: BankAccount = {
    id: BANK_ACCOUNT_ID,
    orgId: ORGANIZATION_ID,
    clientId: CLIENT_ID,
    provider: "manual",
    bankOrg: null,
    bankFid: null,
    bankName: "Banco Refresh",
    bankCode: null,
    branch: "0001",
    accountNumberMask: "***7777",
    accountType: "corrente",
    currency: "BRL",
    accountFingerprint: "refresh-fingerprint",
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await storage.createUser(master);
  await storage.upsertClient(client);
  await storage.upsertBankAccount(bankAccount);
  await storage.setBankTransactions(CLIENT_ID, [], BANK_ACCOUNT_ID);
  await storage.setSaleLegs(CLIENT_ID, []);

  const baseCategories = await storage.getPjCategories();
  const timestamp = new Date().toISOString();
  const categorySeeds: PjClientCategory[] = baseCategories.map(category => ({
    id: `${CLIENT_ID}-${category.code}`,
    orgId: ORGANIZATION_ID,
    clientId: CLIENT_ID,
    name: category.name,
    description: category.description,
    parentId: null,
    baseCategoryId: category.id,
    acceptsPostings: category.acceptsPostings,
    level: category.level,
    path: category.path,
    sortOrder: category.sortOrder,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));

  await storage.bulkInsertPjClientCategories(ORGANIZATION_ID, CLIENT_ID, categorySeeds);
}

describe("PJ snapshot refresh hooks", () => {
  let appServer: import("http").Server;
  let currentStorage: MemStorage;

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use(
      session({
        secret: "refresh-secret", 
        resave: false,
        saveUninitialized: false,
      })
    );

    currentStorage = new MemStorage();
    setStorageProvider(currentStorage);
    await seedBase(currentStorage);

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
    await seedBase(currentStorage);
  });

  it("recomputes 30/90/365-day snapshots after OFX imports", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_EMAIL, password: MASTER_PASSWORD })
      .expect(200);

    const response = await agent
      .post(`/api/pj/import/ofx?clientId=${CLIENT_ID}`)
      .attach("ofx", Buffer.from(SIMPLE_OFX, "utf8"), {
        filename: "refresh.ofx",
        contentType: "application/ofx",
      });

    assert.equal(response.status, 200);

    const snapshots = await currentStorage.getBankSummarySnapshots(
      ORGANIZATION_ID,
      CLIENT_ID,
      BANK_ACCOUNT_ID
    );

    assert.equal(snapshots.length, 3, "expected three snapshot windows");

    const window30 = snapshots.find(entry => entry.window === "30d");
    assert.ok(window30, "30-day snapshot should exist");
    assert.deepEqual(window30?.totals, {
      totalIn: 1000,
      totalOut: 200,
      balance: 800,
    });
    assert.equal(window30?.metadata?.coverageDays, 30);
    assert.equal(window30?.metadata?.transactionCount, 2);
    assert.ok(Array.isArray(window30?.metadata?.series?.dailyNetFlows));
    assert.equal(window30?.metadata?.series?.dailyNetFlows?.length, 2);

    const window90 = snapshots.find(entry => entry.window === "90d");
    assert.ok(window90, "90-day snapshot should exist");
    assert.equal(window90?.metadata?.coverageDays, 90);

    const window365 = snapshots.find(entry => entry.window === "365d");
    assert.ok(window365, "365-day snapshot should exist");
    assert.equal(window365?.metadata?.coverageDays, 365);
  });

  it("updates receivable KPIs after reconciliation", async () => {
    const transactions: BankTransaction[] = [
      {
        bankTxId: "recon-1",
        date: "05/01/2024",
        desc: "Receita",
        amount: 500,
        bankAccountId: BANK_ACCOUNT_ID,
        linkedLegs: [],
      },
      {
        bankTxId: "recon-2",
        date: "10/01/2024",
        desc: "Despesa",
        amount: -100,
        bankAccountId: BANK_ACCOUNT_ID,
        linkedLegs: [],
      },
    ];

    const saleLeg: SaleLeg = {
      saleLegId: "leg-refresh",
      saleId: "sale-refresh",
      method: "pix",
      gateway: undefined,
      authorizedCode: undefined,
      installments: 1,
      grossAmount: 500,
      fees: 0,
      netAmount: 500,
      status: "autorizado",
      provider: "manual",
      providerPaymentId: undefined,
      providerAccountId: undefined,
      settlementPlan: [
        { n: 1, due: "12/01/2024", expected: 500 },
      ],
      reconciliation: {
        state: "pendente",
      },
      events: [],
    };

    await currentStorage.setBankTransactions(CLIENT_ID, transactions, BANK_ACCOUNT_ID);
    await currentStorage.setSaleLegs(CLIENT_ID, [saleLeg]);

    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_EMAIL, password: MASTER_PASSWORD })
      .expect(200);

    await agent
      .post("/api/pj/reconciliation/confirm")
      .send({
        clientId: CLIENT_ID,
        saleLegId: saleLeg.saleLegId,
        matches: [
          {
            parcelN: 1,
            bankTxId: "recon-1",
          },
        ],
      })
      .expect(200);

    const snapshots = await currentStorage.getBankSummarySnapshots(
      ORGANIZATION_ID,
      CLIENT_ID,
      BANK_ACCOUNT_ID
    );

    assert.ok(snapshots.length >= 1, "expected snapshots after reconciliation");

    const window30 = snapshots.find(entry => entry.window === "30d");
    assert.ok(window30, "30-day snapshot should exist after reconciliation");
    assert.equal(window30?.kpis.receivableCount, 0);
    assert.equal(window30?.kpis.receivableAmount, 0);
    assert.equal(window30?.totals.totalIn, 500);
    assert.equal(window30?.totals.totalOut, 100);
    assert.equal(window30?.metadata?.transactionCount, 2);
  });
});
