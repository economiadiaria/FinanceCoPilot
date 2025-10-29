import { describe, before, after, beforeEach, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import bcrypt from "bcrypt";

import { registerRoutes } from "../server/routes";
import { MemStorage, setStorageProvider, type IStorage } from "../server/storage";
import type { BankAccount, BankTransaction, Client, SaleLeg, User } from "@shared/schema";
import { toISOFromBR } from "@shared/utils";

const ORG_ONE = "org-1";
const ORG_TWO = "org-2";
const CLIENT_MAIN = "pj-client-1";
const CLIENT_OTHER = "pj-client-2";
const BANK_ACCOUNT_MAIN = "bank-account-1";
const BANK_ACCOUNT_OTHER = "bank-account-2";
const MASTER_ONE_EMAIL = "master1@pj.example.com";
const MASTER_ONE_PASSWORD = "master-one";
const MASTER_TWO_EMAIL = "master2@pj.example.com";
const MASTER_TWO_PASSWORD = "master-two";

async function seedStorage(storage: IStorage) {
  const now = new Date().toISOString();

  const masterOrgOne: User = {
    userId: "user-master-1",
    email: MASTER_ONE_EMAIL,
    passwordHash: await bcrypt.hash(MASTER_ONE_PASSWORD, 10),
    role: "master",
    name: "Master PJ Org",
    organizationId: ORG_ONE,
    clientIds: [CLIENT_MAIN, CLIENT_OTHER],
    managedConsultantIds: [],
    managedClientIds: [CLIENT_MAIN, CLIENT_OTHER],
  };

  const masterOrgTwo: User = {
    userId: "user-master-2",
    email: MASTER_TWO_EMAIL,
    passwordHash: await bcrypt.hash(MASTER_TWO_PASSWORD, 10),
    role: "master",
    name: "Master Outra Org",
    organizationId: ORG_TWO,
    clientIds: [],
    managedConsultantIds: [],
    managedClientIds: [],
  };

  const clientMain: Client = {
    clientId: CLIENT_MAIN,
    name: "Cliente Principal PJ",
    type: "PJ",
    email: "cliente-principal@pj.example.com",
    organizationId: ORG_ONE,
    consultantId: null,
    masterId: masterOrgOne.userId,
  };

  const clientOther: Client = {
    clientId: CLIENT_OTHER,
    name: "Cliente Secundário PJ",
    type: "PJ",
    email: "cliente-secundario@pj.example.com",
    organizationId: ORG_ONE,
    consultantId: null,
    masterId: masterOrgOne.userId,
  };

  const bankAccountMain: BankAccount = {
    id: BANK_ACCOUNT_MAIN,
    orgId: ORG_ONE,
    clientId: CLIENT_MAIN,
    provider: "manual",
    bankOrg: null,
    bankFid: null,
    bankName: "Banco Principal",
    bankCode: null,
    branch: "0001",
    accountNumberMask: "***1234",
    accountType: "corrente",
    currency: "BRL",
    accountFingerprint: "fingerprint-main",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  const bankAccountOther: BankAccount = {
    id: BANK_ACCOUNT_OTHER,
    orgId: ORG_ONE,
    clientId: CLIENT_OTHER,
    provider: "manual",
    bankOrg: null,
    bankFid: null,
    bankName: "Banco Secundário",
    bankCode: null,
    branch: "0001",
    accountNumberMask: "***9876",
    accountType: "corrente",
    currency: "BRL",
    accountFingerprint: "fingerprint-other",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  const transactionsMain: BankTransaction[] = [
    {
      bankTxId: "tx-1",
      date: "05/01/2024",
      desc: "Entrada contrato A",
      amount: 1000,
      bankAccountId: BANK_ACCOUNT_MAIN,
      linkedLegs: [],
    },
    {
      bankTxId: "tx-2",
      date: "10/01/2024",
      desc: "Pagamento fornecedor",
      amount: -200,
      bankAccountId: BANK_ACCOUNT_MAIN,
      linkedLegs: [],
    },
    {
      bankTxId: "tx-3",
      date: "15/01/2024",
      desc: "Entrada contrato B",
      amount: 500,
      bankAccountId: BANK_ACCOUNT_MAIN,
      linkedLegs: [],
    },
    {
      bankTxId: "tx-4",
      date: "20/02/2024",
      desc: "Despesa fora do período",
      amount: -150,
      bankAccountId: BANK_ACCOUNT_MAIN,
      linkedLegs: [],
    },
  ];

  const saleLegsMain: SaleLeg[] = [
    {
      saleLegId: "leg-1",
      saleId: "sale-1",
      method: "pix",
      gateway: undefined,
      authorizedCode: undefined,
      installments: 2,
      grossAmount: 1200,
      fees: 60,
      netAmount: 1140,
      status: "liquidado",
      provider: "manual",
      providerPaymentId: undefined,
      providerAccountId: undefined,
      settlementPlan: [
        { n: 1, due: "12/01/2024", expected: 600 },
        { n: 2, due: "25/01/2024", expected: 540, receivedTxId: "tx-3", receivedAt: "15/01/2024" },
        { n: 3, due: "15/02/2024", expected: 600 },
      ],
      reconciliation: {
        state: "pendente",
      },
      events: [],
    },
    {
      saleLegId: "leg-2",
      saleId: "sale-2",
      method: "boleto",
      gateway: undefined,
      authorizedCode: undefined,
      installments: 1,
      grossAmount: 200,
      fees: 0,
      netAmount: 200,
      status: "pago",
      provider: "manual",
      providerPaymentId: undefined,
      providerAccountId: undefined,
      settlementPlan: [
        { n: 1, due: "20/01/2024", expected: 200 },
      ],
      reconciliation: {
        state: "pendente",
      },
      events: [],
    },
  ];

  await storage.createUser(masterOrgOne);
  await storage.createUser(masterOrgTwo);
  await storage.upsertClient(clientMain);
  await storage.upsertClient(clientOther);
  await storage.upsertBankAccount(bankAccountMain);
  await storage.upsertBankAccount(bankAccountOther);
  await storage.setBankTransactions(CLIENT_MAIN, transactionsMain, BANK_ACCOUNT_MAIN);
  await storage.setSaleLegs(CLIENT_MAIN, saleLegsMain);
}

describe("PJ summary endpoint", () => {
  let appServer: import("http").Server;
  let storageProvider: MemStorage;

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

    storageProvider = new MemStorage();
    setStorageProvider(storageProvider);
    await seedStorage(storageProvider);

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
    storageProvider = new MemStorage();
    setStorageProvider(storageProvider);
    await seedStorage(storageProvider);
  });

  it("returns KPI summary for the requested period", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_ONE_EMAIL, password: MASTER_ONE_PASSWORD })
      .expect(200);

    const response = await agent
      .get("/api/pj/summary")
      .query({
        clientId: CLIENT_MAIN,
        bankAccountId: BANK_ACCOUNT_MAIN,
        from: "01/01/2024",
        to: "31/01/2024",
      })
      .expect(200);

    assert.equal(response.headers["cache-control"], "private, max-age=30");
    assert.ok(response.headers.etag);

    const body = response.body;
    assert.equal(body.clientId, CLIENT_MAIN);
    assert.equal(body.bankAccountId, BANK_ACCOUNT_MAIN);
    assert.equal(body.from, "01/01/2024");
    assert.equal(body.to, "31/01/2024");

    assert.equal(body.totals.totalIn, 1500);
    assert.equal(body.totals.totalOut, 200);
    assert.equal(body.totals.balance, 1300);

    assert.equal(body.kpis.inflowCount, 2);
    assert.equal(body.kpis.outflowCount, 1);
    assert.equal(body.kpis.largestIn, 1000);
    assert.equal(body.kpis.largestOut, 200);
    assert.equal(body.kpis.receivableAmount, 800);
    assert.equal(body.kpis.receivableCount, 2);
    assert.equal(body.kpis.projectedBalance, 2100);

    const now = new Date();
    const maybeOverdue = ["12/01/2024", "20/01/2024"].filter(date => {
      const iso = toISOFromBR(date);
      return new Date(iso) < now;
    });
    const expectedOverdueAmount = maybeOverdue.includes("12/01/2024") ? 600 : 0;
    const expectedOverdueWithSecond = maybeOverdue.includes("20/01/2024")
      ? expectedOverdueAmount + 200
      : expectedOverdueAmount;

    assert.equal(body.kpis.overdueReceivableAmount, expectedOverdueWithSecond);

    assert.equal(body.metadata.transactionCount, 3);
    assert.ok(Array.isArray(body.series.dailyNetFlows));
    assert.deepEqual(
      body.series.dailyNetFlows.map((entry: any) => entry.date),
      ["05/01/2024", "10/01/2024", "15/01/2024"]
    );
  });

  it("prevents cross-tenant access to bank account data", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_ONE_EMAIL, password: MASTER_ONE_PASSWORD })
      .expect(200);

    const forbidden = await agent
      .get("/api/pj/summary")
      .query({
        clientId: CLIENT_MAIN,
        bankAccountId: BANK_ACCOUNT_OTHER,
        from: "01/01/2024",
        to: "31/01/2024",
      })
      .expect(404);

    const missing = await agent
      .get("/api/pj/summary")
      .query({
        clientId: CLIENT_MAIN,
        bankAccountId: "missing-account",
        from: "01/01/2024",
        to: "31/01/2024",
      })
      .expect(404);

    assert.deepEqual(forbidden.body, missing.body);

    const auditLogs = await storageProvider.getAuditLogs(ORG_ONE);
    const deniedEvent = auditLogs.find(
      entry => entry.eventType === "security.access_denied.bank_account" && entry.targetId === BANK_ACCOUNT_OTHER
    );
    assert.ok(deniedEvent, "expected bank-account denial to be audited");
    assert.equal(deniedEvent?.targetType, "bank_account");
    assert.equal(deniedEvent?.targetId, BANK_ACCOUNT_OTHER);
    const metadata = deniedEvent?.metadata as Record<string, unknown> | undefined;
    assert.equal(metadata?.clientId, CLIENT_MAIN);
    assert.equal(metadata?.bankAccountId, BANK_ACCOUNT_OTHER);
    assert.equal(metadata?.reason, "bank_account_not_linked");
  });

  it("returns 404 when the bank account does not exist", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_ONE_EMAIL, password: MASTER_ONE_PASSWORD })
      .expect(200);

    const response = await agent
      .get("/api/pj/summary")
      .query({
        clientId: CLIENT_MAIN,
        bankAccountId: "missing-account",
        from: "01/01/2024",
        to: "31/01/2024",
      })
      .expect(404);

    assert.match(response.body.error, /conta bancária não encontrada/i);

    const auditLogs = await storageProvider.getAuditLogs(ORG_ONE);
    const deniedEvent = auditLogs.find(
      entry => entry.eventType === "security.access_denied.bank_account" && entry.targetId === "missing-account"
    );
    assert.ok(deniedEvent, "expected missing bank account to be audited");
    assert.equal(deniedEvent?.targetType, "bank_account");
    assert.equal(deniedEvent?.targetId, "missing-account");
    const metadata = deniedEvent?.metadata as Record<string, unknown> | undefined;
    assert.equal(metadata?.clientId, CLIENT_MAIN);
    assert.equal(metadata?.bankAccountId, "missing-account");
    assert.equal(metadata?.reason, "bank_account_not_found");
  });

  it("denies access for users from another organization", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_TWO_EMAIL, password: MASTER_TWO_PASSWORD })
      .expect(200);

    const forbidden = await agent
      .get("/api/pj/summary")
      .query({
        clientId: CLIENT_MAIN,
        bankAccountId: BANK_ACCOUNT_MAIN,
        from: "01/01/2024",
        to: "31/01/2024",
      })
      .expect(404);

    const missing = await agent
      .get("/api/pj/summary")
      .query({
        clientId: "missing-client",
        bankAccountId: "missing-account",
        from: "01/01/2024",
        to: "31/01/2024",
      })
      .expect(404);

    assert.deepEqual(forbidden.body, missing.body);
  });
});

