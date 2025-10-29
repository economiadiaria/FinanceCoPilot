import { describe, before, after, beforeEach, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import bcrypt from "bcrypt";

import { registerRoutes } from "../server/routes";
import { MemStorage, setStorageProvider, type IStorage } from "../server/storage";
import type { Client, User } from "@shared/schema";

const ORG_PRIMARY = "org-primary";
const ORG_FOREIGN = "org-foreign";
const CLIENT_PRIMARY_ID = "client-primary";
const CLIENT_FOREIGN_ID = "client-foreign";

const MASTER_FOREIGN_EMAIL = "master@foreign.org";
const MASTER_FOREIGN_PASSWORD = "master-foreign";
const CONSULTANT_FOREIGN_EMAIL = "consultant@foreign.org";
const CONSULTANT_FOREIGN_PASSWORD = "consultant-foreign";
const CLIENT_FOREIGN_EMAIL = "client@foreign.org";
const CLIENT_FOREIGN_PASSWORD = "client-foreign";

async function seedStorage(storage: IStorage) {
  const primaryMaster: User = {
    userId: "user-master-primary",
    email: "master@primary.org",
    passwordHash: await bcrypt.hash("master-primary", 10),
    role: "master",
    name: "Master Primário",
    organizationId: ORG_PRIMARY,
    clientIds: [CLIENT_PRIMARY_ID],
    managedConsultantIds: [],
    managedClientIds: [CLIENT_PRIMARY_ID],
  };

  const foreignMaster: User = {
    userId: "user-master-foreign",
    email: MASTER_FOREIGN_EMAIL,
    passwordHash: await bcrypt.hash(MASTER_FOREIGN_PASSWORD, 10),
    role: "master",
    name: "Master Estrangeiro",
    organizationId: ORG_FOREIGN,
    clientIds: [CLIENT_FOREIGN_ID],
    managedConsultantIds: [],
    managedClientIds: [CLIENT_FOREIGN_ID],
  };

  const foreignConsultant: User = {
    userId: "user-consultant-foreign",
    email: CONSULTANT_FOREIGN_EMAIL,
    passwordHash: await bcrypt.hash(CONSULTANT_FOREIGN_PASSWORD, 10),
    role: "consultor",
    name: "Consultor Estrangeiro",
    organizationId: ORG_FOREIGN,
    clientIds: [CLIENT_FOREIGN_ID],
    managedConsultantIds: [],
    managedClientIds: [],
    managerId: foreignMaster.userId,
  };

  const foreignClientUser: User = {
    userId: "user-client-foreign",
    email: CLIENT_FOREIGN_EMAIL,
    passwordHash: await bcrypt.hash(CLIENT_FOREIGN_PASSWORD, 10),
    role: "cliente",
    name: "Cliente Estrangeiro",
    organizationId: ORG_FOREIGN,
    clientIds: [CLIENT_FOREIGN_ID],
    managedConsultantIds: [],
    managedClientIds: [],
    consultantId: foreignConsultant.userId,
  };

  const primaryClient: Client = {
    clientId: CLIENT_PRIMARY_ID,
    name: "Cliente Primário",
    type: "PF",
    email: "cliente@primary.org",
    organizationId: ORG_PRIMARY,
    consultantId: null,
    masterId: primaryMaster.userId,
  };

  const foreignClient: Client = {
    clientId: CLIENT_FOREIGN_ID,
    name: "Cliente Estrangeiro",
    type: "PF",
    email: "cliente@foreign.org",
    organizationId: ORG_FOREIGN,
    consultantId: foreignConsultant.userId,
    masterId: foreignMaster.userId,
  };

  await storage.createUser(primaryMaster);
  await storage.createUser(foreignMaster);
  await storage.createUser(foreignConsultant);
  await storage.createUser(foreignClientUser);

  await storage.upsertClient(primaryClient);
  await storage.upsertClient(foreignClient);
}

describe("Open Finance client isolation", () => {
  let appServer: import("http").Server;

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use(
      session({
        secret: "openfinance-test",
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

  it("returns neutral not found when a foreign master starts an Open Finance consent", async () => {
    const agent = request.agent(appServer);

    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_FOREIGN_EMAIL, password: MASTER_FOREIGN_PASSWORD })
      .expect(200);

    const forbidden = await agent
      .post("/api/openfinance/consent/start")
      .send({ clientId: CLIENT_PRIMARY_ID })
      .expect(404);

    const missing = await agent
      .post("/api/openfinance/consent/start")
      .send({ clientId: "missing-client" })
      .expect(404);

    assert.deepEqual(forbidden.body, missing.body);
  });

  it("denies Open Finance sync for consultants from another organization", async () => {
    const agent = request.agent(appServer);

    await agent
      .post("/api/auth/login")
      .send({ email: CONSULTANT_FOREIGN_EMAIL, password: CONSULTANT_FOREIGN_PASSWORD })
      .expect(200);

    const forbidden = await agent
      .post("/api/openfinance/sync")
      .send({ clientId: CLIENT_PRIMARY_ID })
      .expect(404);

    const missing = await agent
      .post("/api/openfinance/sync")
      .send({ clientId: "missing-client" })
      .expect(404);

    assert.deepEqual(forbidden.body, missing.body);
  });

  it("blocks Open Finance item listing for clients from another organization", async () => {
    const agent = request.agent(appServer);

    await agent
      .post("/api/auth/login")
      .send({ email: CLIENT_FOREIGN_EMAIL, password: CLIENT_FOREIGN_PASSWORD })
      .expect(200);

    const forbidden = await agent
      .get("/api/openfinance/items")
      .query({ clientId: CLIENT_PRIMARY_ID })
      .expect(404);

    const missing = await agent
      .get("/api/openfinance/items")
      .query({ clientId: "missing-client" })
      .expect(404);

    assert.deepEqual(forbidden.body, missing.body);
  });
});

