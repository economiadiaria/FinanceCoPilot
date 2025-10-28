import { describe, before, after, beforeEach, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import bcrypt from "bcrypt";

import { registerRoutes } from "../server/routes";
import { MemStorage, setStorageProvider, type IStorage } from "../server/storage";
import type { Client, Transaction, User } from "@shared/schema";

const ORG_ONE = "org-1";
const ORG_TWO = "org-2";
const CLIENT_ID = "pf-client-1";
const MASTER_ONE_EMAIL = "master1@pf.example.com";
const MASTER_ONE_PASSWORD = "master-one";
const MASTER_TWO_EMAIL = "master2@pf.example.com";
const MASTER_TWO_PASSWORD = "master-two";
const CONSULTANT_EMAIL = "consultant@pf.example.com";
const CONSULTANT_PASSWORD = "consultant-secret";

async function seedStorage(storage: IStorage) {
  const masterOne: User = {
    userId: "user-master-1",
    email: MASTER_ONE_EMAIL,
    passwordHash: await bcrypt.hash(MASTER_ONE_PASSWORD, 10),
    role: "master",
    name: "Master PF Org",
    organizationId: ORG_ONE,
    clientIds: [CLIENT_ID],
    managedConsultantIds: [],
    managedClientIds: [CLIENT_ID],
  };

  const masterTwo: User = {
    userId: "user-master-2",
    email: MASTER_TWO_EMAIL,
    passwordHash: await bcrypt.hash(MASTER_TWO_PASSWORD, 10),
    role: "master",
    name: "Master Foreign Org",
    organizationId: ORG_TWO,
    clientIds: [],
    managedConsultantIds: [],
    managedClientIds: [],
  };

  const consultantNoLink: User = {
    userId: "user-consultant-1",
    email: CONSULTANT_EMAIL,
    passwordHash: await bcrypt.hash(CONSULTANT_PASSWORD, 10),
    role: "consultor",
    name: "Consultor Sem Acesso",
    organizationId: ORG_ONE,
    clientIds: [],
    managedConsultantIds: [],
    managedClientIds: [],
    managerId: masterOne.userId,
  };

  const pfClient: Client = {
    clientId: CLIENT_ID,
    name: "Cliente PF",
    type: "PF",
    email: "pf-cliente@example.com",
    organizationId: ORG_ONE,
    consultantId: null,
    masterId: masterOne.userId,
  };

  const sampleTransactions: Transaction[] = [
    {
      date: "2024-01-01",
      desc: "Salário",
      amount: 5000,
      status: "pendente",
      category: "Receita",
    },
  ];

  await storage.createUser(masterOne);
  await storage.createUser(masterTwo);
  await storage.createUser(consultantNoLink);
  await storage.upsertClient(pfClient);
  await storage.setTransactions(CLIENT_ID, sampleTransactions);
}

describe("PF validateClientAccess guard", () => {
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

  it("denies PF transaction listing for users from another organization", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_TWO_EMAIL, password: MASTER_TWO_PASSWORD })
      .expect(200);

    const forbidden = await agent
      .get("/api/transactions/list")
      .query({ clientId: CLIENT_ID })
      .expect(403);

    assert.match(forbidden.body.error, /outra organização/i);
  });

  it("blocks OFX imports when the client belongs to another organization", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_TWO_EMAIL, password: MASTER_TWO_PASSWORD })
      .expect(200);

    const response = await agent
      .post("/api/import/ofx")
      .field("clientId", CLIENT_ID)
      .expect(403);

    assert.match(response.body.error, /outra organização/i);
  });

  it("prevents consultants without linkage from categorizing transactions", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: CONSULTANT_EMAIL, password: CONSULTANT_PASSWORD })
      .expect(200);

    const categorizeAttempt = await agent
      .post("/api/transactions/categorize")
      .send({ clientId: CLIENT_ID, indices: [0], category: "Fixo" })
      .expect(403);

    assert.match(categorizeAttempt.body.error, /acesso negado/i);
  });
});
