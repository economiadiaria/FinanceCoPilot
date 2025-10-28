import { describe, before, after, beforeEach, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import bcrypt from "bcrypt";

import { registerRoutes } from "../server/routes";
import { MemStorage, setStorageProvider, type IStorage } from "../server/storage";
import type { BankTransaction, Client, User } from "@shared/schema";

const ORG_ONE = "org-1";
const ORG_TWO = "org-2";
const CLIENT_ONE = "pj-client-1";
const CLIENT_TWO = "pj-client-2";
const ACCOUNT_ONE = "bank-acc-1";
const ACCOUNT_TWO = "bank-acc-2";

const MASTER_ONE_EMAIL = "master1@pj.example.com";
const MASTER_ONE_PASSWORD = "master-one";
const MASTER_TWO_EMAIL = "master2@pj.example.com";
const MASTER_TWO_PASSWORD = "master-two";

const buildTransaction = (overrides: Partial<BankTransaction>): BankTransaction => ({
  bankTxId: "tx-unknown",
  date: "01/01/2024",
  desc: "Transação",
  amount: 0,
  bankAccountId: ACCOUNT_ONE,
  linkedLegs: [],
  reconciled: false,
  ...overrides,
});

const SEED_TRANSACTIONS: BankTransaction[] = [
  buildTransaction({ bankTxId: "tx-001", date: "01/03/2024", amount: 100 }),
  buildTransaction({ bankTxId: "tx-002", date: "01/03/2024", amount: 200 }),
  buildTransaction({ bankTxId: "tx-003", date: "02/03/2024", amount: 300 }),
  buildTransaction({ bankTxId: "tx-004", date: "02/03/2024", amount: 400 }),
  buildTransaction({ bankTxId: "tx-005", date: "03/03/2024", amount: 500 }),
];

async function seedStorage(storage: IStorage) {
  const now = new Date().toISOString();

  const masterOne: User = {
    userId: "master-org-1",
    email: MASTER_ONE_EMAIL,
    passwordHash: await bcrypt.hash(MASTER_ONE_PASSWORD, 10),
    role: "master",
    name: "Master Org 1",
    organizationId: ORG_ONE,
    clientIds: [CLIENT_ONE],
    managedConsultantIds: [],
    managedClientIds: [CLIENT_ONE],
  };

  const masterTwo: User = {
    userId: "master-org-2",
    email: MASTER_TWO_EMAIL,
    passwordHash: await bcrypt.hash(MASTER_TWO_PASSWORD, 10),
    role: "master",
    name: "Master Org 2",
    organizationId: ORG_TWO,
    clientIds: [CLIENT_TWO],
    managedConsultantIds: [],
    managedClientIds: [CLIENT_TWO],
  };

  const clientOne: Client = {
    clientId: CLIENT_ONE,
    name: "Empresa Org 1",
    type: "PJ",
    email: "empresa-org1@example.com",
    organizationId: ORG_ONE,
    consultantId: null,
    masterId: masterOne.userId,
  };

  const clientTwo: Client = {
    clientId: CLIENT_TWO,
    name: "Empresa Org 2",
    type: "PJ",
    email: "empresa-org2@example.com",
    organizationId: ORG_TWO,
    consultantId: null,
    masterId: masterTwo.userId,
  };

  await storage.createUser(masterOne);
  await storage.createUser(masterTwo);
  await storage.upsertClient(clientOne);
  await storage.upsertClient(clientTwo);

  await storage.upsertBankAccount({
    id: ACCOUNT_ONE,
    orgId: ORG_ONE,
    clientId: CLIENT_ONE,
    provider: "manual",
    bankOrg: null,
    bankFid: null,
    bankName: "Banco Org 1",
    bankCode: null,
    branch: null,
    accountNumberMask: "****1234",
    accountType: "corrente",
    currency: "BRL",
    accountFingerprint: "org-1-account-1",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  await storage.upsertBankAccount({
    id: ACCOUNT_TWO,
    orgId: ORG_TWO,
    clientId: CLIENT_TWO,
    provider: "manual",
    bankOrg: null,
    bankFid: null,
    bankName: "Banco Org 2",
    bankCode: null,
    branch: null,
    accountNumberMask: "****5678",
    accountType: "corrente",
    currency: "BRL",
    accountFingerprint: "org-2-account-1",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  await storage.setBankTransactions(CLIENT_ONE, SEED_TRANSACTIONS, ACCOUNT_ONE);

  const foreignTransactions = [
    buildTransaction({ bankTxId: "foreign-001", bankAccountId: ACCOUNT_TWO, date: "05/03/2024", amount: 900 }),
  ];
  await storage.setBankTransactions(CLIENT_TWO, foreignTransactions, ACCOUNT_TWO);
}

describe("GET /api/pj/transactions", () => {
  let appServer: import("http").Server;

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

    const storage = new MemStorage();
    setStorageProvider(storage);
    await seedStorage(storage);

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
    const storage = new MemStorage();
    setStorageProvider(storage);
    await seedStorage(storage);
  });

  it("returns deterministic pagination with ETag support", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_ONE_EMAIL, password: MASTER_ONE_PASSWORD })
      .expect(200);

    const firstPage = await agent
      .get("/api/pj/transactions")
      .query({ clientId: CLIENT_ONE, bankAccountId: ACCOUNT_ONE, sort: "desc", page: 1, limit: 2 })
      .expect(200);

    assert.equal(firstPage.body.items.length, 2);
    assert.ok(firstPage.headers["etag"], "ETag header should be present");
    assert.match(String(firstPage.headers["cache-control"] ?? ""), /private/);

    const secondPage = await agent
      .get("/api/pj/transactions")
      .query({ clientId: CLIENT_ONE, bankAccountId: ACCOUNT_ONE, sort: "desc", page: 2, limit: 2 })
      .expect(200);

    const secondCall = await agent
      .get("/api/pj/transactions")
      .set("If-None-Match", String(firstPage.headers["etag"]))
      .query({ clientId: CLIENT_ONE, bankAccountId: ACCOUNT_ONE, sort: "desc", page: 1, limit: 2 })
      .expect(304);

    assert.equal(secondCall.text, "");

    const firstIds = firstPage.body.items.map((tx: BankTransaction) => tx.bankTxId);
    const secondIds = secondPage.body.items.map((tx: BankTransaction) => tx.bankTxId);
    assert.deepEqual(firstIds, ["tx-005", "tx-004"]);
    assert.deepEqual(secondIds, ["tx-003", "tx-002"]);

    const repeatedSecondPage = await agent
      .get("/api/pj/transactions")
      .query({ clientId: CLIENT_ONE, bankAccountId: ACCOUNT_ONE, sort: "desc", page: 2, limit: 2 })
      .expect(200);

    const repeatedIds = repeatedSecondPage.body.items.map((tx: BankTransaction) => tx.bankTxId);
    assert.deepEqual(repeatedIds, secondIds, "Pagination ordering should be stable across calls");

    assert.deepEqual(secondPage.body.pagination, {
      page: 2,
      limit: 2,
      totalItems: SEED_TRANSACTIONS.length,
      totalPages: Math.ceil(SEED_TRANSACTIONS.length / 2),
      hasNextPage: true,
      hasPreviousPage: true,
    });
  });

  it("rejects access to bank transactions from another organization", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_ONE_EMAIL, password: MASTER_ONE_PASSWORD })
      .expect(200);

    const forbidden = await agent
      .get("/api/pj/transactions")
      .query({ clientId: CLIENT_TWO, bankAccountId: ACCOUNT_TWO })
      .expect(403);

    assert.match(forbidden.body.error, /outra organização/i);
  });
});
