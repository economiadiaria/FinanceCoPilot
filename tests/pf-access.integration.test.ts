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
const CLIENT_EMAIL = "cliente@pf.example.com";
const CLIENT_PASSWORD = "cliente-secret";

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

  const clientUser: User = {
    userId: "user-client-1",
    email: CLIENT_EMAIL,
    passwordHash: await bcrypt.hash(CLIENT_PASSWORD, 10),
    role: "cliente",
    name: "Cliente Final",
    organizationId: ORG_ONE,
    clientIds: [CLIENT_ID],
    managedConsultantIds: [],
    managedClientIds: [],
    consultantId: undefined,
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
  await storage.createUser(clientUser);
  await storage.upsertClient(pfClient);
  await storage.setTransactions(CLIENT_ID, sampleTransactions);
}

describe("PF validateClientAccess guard", () => {
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

  it("denies PF transaction listing for users from another organization", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_TWO_EMAIL, password: MASTER_TWO_PASSWORD })
      .expect(200);

    const forbidden = await agent
      .get("/api/transactions/list")
      .query({ clientId: CLIENT_ID })
      .expect(404);

    const missing = await agent
      .get("/api/transactions/list")
      .query({ clientId: "missing-client" })
      .expect(404);

    assert.deepEqual(forbidden.body, missing.body);

    const auditLogs = await storageProvider.getAuditLogs(ORG_TWO);
    const deniedEvent = auditLogs.find(entry => entry.eventType === "security.access_denied.organization");
    assert.ok(deniedEvent, "expected organization mismatch to be audited");
    assert.equal(deniedEvent?.targetType, "client");
    assert.equal(deniedEvent?.targetId, CLIENT_ID);
    const metadata = deniedEvent?.metadata as Record<string, unknown> | undefined;
    assert.equal(metadata?.clientId, CLIENT_ID);
    assert.equal(metadata?.reason, "organization_mismatch");
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
      .expect(404);

    const missing = await agent
      .post("/api/import/ofx")
      .field("clientId", "missing-client")
      .expect(404);

    assert.deepEqual(response.body, missing.body);
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

    const auditLogs = await storageProvider.getAuditLogs(ORG_ONE);
    const deniedEvent = auditLogs.find(entry => entry.eventType === "security.access_denied.client_link");
    assert.ok(deniedEvent, "expected client linkage denial to be audited");
    assert.equal(deniedEvent?.targetType, "client");
    assert.equal(deniedEvent?.targetId, CLIENT_ID);
    const metadata = deniedEvent?.metadata as Record<string, unknown> | undefined;
    assert.equal(metadata?.clientId, CLIENT_ID);
    assert.equal(metadata?.reason, "client_not_linked");
    assert.equal(metadata?.userRole, "consultor");
  });

  it("denies PF summary for users from another organization", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_TWO_EMAIL, password: MASTER_TWO_PASSWORD })
      .expect(200);

    const forbidden = await agent
      .get("/api/summary")
      .query({ clientId: CLIENT_ID })
      .expect(404);

    const missing = await agent
      .get("/api/summary")
      .query({ clientId: "missing-client" })
      .expect(404);

    assert.deepEqual(forbidden.body, missing.body);
  });

  it("denies investment data access for users from another organization", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_TWO_EMAIL, password: MASTER_TWO_PASSWORD })
      .expect(200);

    const positionsForbidden = await agent
      .get("/api/investments/positions")
      .query({ clientId: CLIENT_ID })
      .expect(404);

    const positionsMissing = await agent
      .get("/api/investments/positions")
      .query({ clientId: "missing-client" })
      .expect(404);

    assert.deepEqual(positionsForbidden.body, positionsMissing.body);

    const rebalanceForbidden = await agent
      .post("/api/investments/rebalance/suggest")
      .send({ clientId: CLIENT_ID })
      .expect(404);

    const rebalanceMissing = await agent
      .post("/api/investments/rebalance/suggest")
      .send({ clientId: "missing-client" })
      .expect(404);

    assert.deepEqual(rebalanceForbidden.body, rebalanceMissing.body);
  });

  it("denies report and policy access across organizations", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_TWO_EMAIL, password: MASTER_TWO_PASSWORD })
      .expect(200);

    const reportView = await agent
      .get("/api/reports/view")
      .query({ clientId: CLIENT_ID, period: "2024-01" })
      .expect(404);
    const reportViewMissing = await agent
      .get("/api/reports/view")
      .query({ clientId: "missing-client", period: "2024-01" })
      .expect(404);
    assert.deepEqual(reportView.body, reportViewMissing.body);

    const reportGenerate = await agent
      .post("/api/reports/generate")
      .send({ clientId: CLIENT_ID, period: "2024-01" })
      .expect(404);
    const reportGenerateMissing = await agent
      .post("/api/reports/generate")
      .send({ clientId: "missing-client", period: "2024-01" })
      .expect(404);
    assert.deepEqual(reportGenerate.body, reportGenerateMissing.body);

    const policyView = await agent
      .get("/api/policies")
      .query({ clientId: CLIENT_ID })
      .expect(404);
    const policyViewMissing = await agent
      .get("/api/policies")
      .query({ clientId: "missing-client" })
      .expect(404);
    assert.deepEqual(policyView.body, policyViewMissing.body);

    const policyUpdate = await agent
      .post("/api/policies/upsert")
      .send({ clientId: CLIENT_ID, data: { targets: { RF: 50, RV: 30, Fundos: 10, Outros: 10 } } })
      .expect(404);
    const policyUpdateMissing = await agent
      .post("/api/policies/upsert")
      .send({ clientId: "missing-client", data: { targets: { RF: 50, RV: 30, Fundos: 10, Outros: 10 } } })
      .expect(404);
    assert.deepEqual(policyUpdate.body, policyUpdateMissing.body);
  });

  it("blocks client users from mutating investment and report data", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: CLIENT_EMAIL, password: CLIENT_PASSWORD })
      .expect(200);

    const positionAttempt = await agent
      .post("/api/investments/positions")
      .send({ clientId: CLIENT_ID, position: { asset: "Teste", class: "RV", value: 100 } })
      .expect(403);
    assert.match(positionAttempt.body.error, /acesso negado/i);

    const rebalanceAttempt = await agent
      .post("/api/investments/rebalance/suggest")
      .send({ clientId: CLIENT_ID })
      .expect(403);
    assert.match(rebalanceAttempt.body.error, /acesso negado/i);

    const reportAttempt = await agent
      .post("/api/reports/generate")
      .send({ clientId: CLIENT_ID, period: "2024-01" })
      .expect(403);
    assert.match(reportAttempt.body.error, /acesso negado/i);

    const policyAttempt = await agent
      .post("/api/policies/upsert")
      .send({ clientId: CLIENT_ID, data: { targets: { RF: 60, RV: 20, Fundos: 10, Outros: 10 } } })
      .expect(403);
    assert.match(policyAttempt.body.error, /acesso negado/i);
  });
});
