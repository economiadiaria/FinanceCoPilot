import { describe, before, after, beforeEach, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import bcrypt from "bcrypt";
import { registerRoutes } from "../server/routes";
import { MemStorage, setStorageProvider, type IStorage } from "../server/storage";
import type { Client, User } from "@shared/schema";

async function seedStorage(storage: IStorage) {
  const masterPassword = await bcrypt.hash("master-secret", 10);
  const consultantPassword = await bcrypt.hash("consult-secret", 10);
  const orgMaster: User = {
    userId: "master-org-1",
    email: "master1@example.com",
    passwordHash: masterPassword,
    role: "master",
    name: "Master Org 1",
    organizationId: "org-1",
    clientIds: [],
    managedConsultantIds: ["consult-org-1"],
    managedClientIds: ["client-org-1"],
  };
  const consultant: User = {
    userId: "consult-org-1",
    email: "consult1@example.com",
    passwordHash: consultantPassword,
    role: "consultor",
    name: "Consultor Org 1",
    organizationId: "org-1",
    clientIds: ["client-org-1"],
    managedConsultantIds: [],
    managedClientIds: [],
    managerId: "master-org-1",
  };
  const foreignMaster: User = {
    userId: "master-org-2",
    email: "master2@example.com",
    passwordHash: await bcrypt.hash("master-two", 10),
    role: "master",
    name: "Master Org 2",
    organizationId: "org-2",
    clientIds: [],
    managedConsultantIds: [],
    managedClientIds: ["client-org-2"],
  };

  const orgClient: Client = {
    clientId: "client-org-1",
    name: "Empresa Org 1",
    type: "PJ",
    email: "empresa1@example.com",
    organizationId: "org-1",
    consultantId: consultant.userId,
    masterId: orgMaster.userId,
  };

  const foreignClient: Client = {
    clientId: "client-org-2",
    name: "Empresa Org 2",
    type: "PJ",
    email: "empresa2@example.com",
    organizationId: "org-2",
    consultantId: null,
    masterId: foreignMaster.userId,
  };

  await storage.createUser(orgMaster);
  await storage.createUser(consultant);
  await storage.createUser(foreignMaster);
  await storage.upsertClient(orgClient);
  await storage.upsertClient(foreignClient);
}

describe("RBAC and organization boundaries", () => {
  let appServer: import("http").Server;

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use(session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: false,
    }));

    const storage = new MemStorage();
    setStorageProvider(storage);
    await seedStorage(storage);

    appServer = await registerRoutes(app);
  });

  after(async () => {
    if (appServer.listening) {
      await new Promise<void>((resolve, reject) => {
        appServer.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  beforeEach(async () => {
    const storage = new MemStorage();
    await seedStorage(storage);
    setStorageProvider(storage);
  });

  it("denies access to clients from other organizations", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: "master1@example.com", password: "master-secret" })
      .expect(200);

    const forbidden = await agent
      .get("/api/pj/bank/transactions")
      .query({ clientId: "client-org-2" })
      .expect(403);

    assert.match(forbidden.body.error, /outra organização/);
  });

  it("limits clients listing to the authenticated organization", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: "master1@example.com", password: "master-secret" })
      .expect(200);

    const response = await agent.get("/api/clients").expect(200);
    const clientIds = response.body.map((client: Client) => client.clientId);
    assert.deepEqual(clientIds.sort(), ["client-org-1"], "only org-1 clients should be visible");
  });

  it("blocks audit log access for non-master users", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: "consult1@example.com", password: "consult-secret" })
      .expect(200);

    await agent.get("/api/audit/logs").expect(403);
  });
});
