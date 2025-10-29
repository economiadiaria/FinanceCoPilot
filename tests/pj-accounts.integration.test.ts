import { describe, before, after, beforeEach, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import bcrypt from "bcrypt";

import { registerRoutes } from "../server/routes";
import { MemStorage, setStorageProvider, type IStorage } from "../server/storage";
import type { BankAccount, Client, User } from "@shared/schema";

const ORG_ONE = "org-accounts-1";
const ORG_TWO = "org-accounts-2";
const CLIENT_ID = "pj-accounts-client";
const MASTER_ONE_EMAIL = "master.accounts@org1.example.com";
const MASTER_ONE_PASSWORD = "master-org1-secret";
const MASTER_TWO_EMAIL = "master.accounts@org2.example.com";
const MASTER_TWO_PASSWORD = "master-org2-secret";

const NOW = new Date().toISOString();

async function seedStorage(storage: IStorage) {
  const masterOrgOne: User = {
    userId: "user-master-org1",
    email: MASTER_ONE_EMAIL,
    passwordHash: await bcrypt.hash(MASTER_ONE_PASSWORD, 10),
    role: "master",
    name: "Master Org One",
    organizationId: ORG_ONE,
    clientIds: [CLIENT_ID],
    managedConsultantIds: [],
    managedClientIds: [CLIENT_ID],
  };

  const masterOrgTwo: User = {
    userId: "user-master-org2",
    email: MASTER_TWO_EMAIL,
    passwordHash: await bcrypt.hash(MASTER_TWO_PASSWORD, 10),
    role: "master",
    name: "Master Org Two",
    organizationId: ORG_TWO,
    clientIds: [],
    managedConsultantIds: [],
    managedClientIds: [],
  };

  const pjClient: Client = {
    clientId: CLIENT_ID,
    name: "Empresa Contas",
    type: "PJ",
    email: "contas@example.com",
    organizationId: ORG_ONE,
    consultantId: null,
    masterId: masterOrgOne.userId,
  };

  const primaryAccount: BankAccount = {
    id: "bank-account-1",
    orgId: ORG_ONE,
    clientId: CLIENT_ID,
    provider: "manual",
    bankOrg: null,
    bankFid: null,
    bankName: "Banco Central",
    bankCode: "001",
    branch: "0001",
    accountNumberMask: "***1234",
    accountType: "checking",
    currency: "BRL",
    accountFingerprint: "fingerprint-1",
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  };

  const secondaryAccount: BankAccount = {
    id: "bank-account-2",
    orgId: ORG_ONE,
    clientId: CLIENT_ID,
    provider: "manual",
    bankOrg: null,
    bankFid: null,
    bankName: "Banco Regional",
    bankCode: "002",
    branch: "0002",
    accountNumberMask: "***5678",
    accountType: "savings",
    currency: "USD",
    accountFingerprint: "fingerprint-2",
    isActive: false,
    createdAt: NOW,
    updatedAt: NOW,
  };

  await storage.createUser(masterOrgOne);
  await storage.createUser(masterOrgTwo);
  await storage.upsertClient(pjClient);
  await storage.upsertBankAccount(primaryAccount);
  await storage.upsertBankAccount(secondaryAccount);
}

describe("PJ account listing", () => {
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

  it("returns PJ accounts with caching headers", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_ONE_EMAIL, password: MASTER_ONE_PASSWORD })
      .expect(200);

    const response = await agent
      .get("/api/pj/accounts")
      .set("X-Request-Id", "req-pj-accounts-1")
      .query({ clientId: CLIENT_ID })
      .expect(200);

    assert.deepEqual(response.body, {
      accounts: [
        {
          id: "bank-account-1",
          bankName: "Banco Central",
          accountNumberMask: "***1234",
          accountType: "checking",
          currency: "BRL",
          isActive: true,
        },
        {
          id: "bank-account-2",
          bankName: "Banco Regional",
          accountNumberMask: "***5678",
          accountType: "savings",
          currency: "USD",
          isActive: false,
        },
      ],
    });

    assert.equal(response.headers["cache-control"], "private, max-age=60");
    assert.equal(response.headers["x-request-id"], "req-pj-accounts-1");
    assert.ok(response.headers.etag, "ETag header should be present");
  });

  it("denies PJ account listing across organizations", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_TWO_EMAIL, password: MASTER_TWO_PASSWORD })
      .expect(200);

    const forbidden = await agent
      .get("/api/pj/accounts")
      .query({ clientId: CLIENT_ID })
      .expect(404);

    const missing = await agent
      .get("/api/pj/accounts")
      .query({ clientId: "missing-client" })
      .expect(404);

    assert.deepEqual(forbidden.body, missing.body);
  });

  it("returns 404 for unknown clients", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_ONE_EMAIL, password: MASTER_ONE_PASSWORD })
      .expect(200);

    const missing = await agent
      .get("/api/pj/accounts")
      .query({ clientId: "missing-client" })
      .expect(404);

    assert.match(missing.body.error, /cliente não encontrado/i);
  });
});
