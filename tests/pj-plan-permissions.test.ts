import { describe, before, after, beforeEach, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import bcrypt from "bcrypt";

import { registerPjCategoryRoutes } from "../server/pj-categories-routes";
import { MemStorage, setStorageProvider } from "../server/storage";
import type { IStorage } from "../server/storage";
import type { Client, User } from "@shared/schema";

const ORG_ID = "org-pj-plan-permissions";
const CLIENT_ID = "client-pj-plan-permissions";

const MASTER_EMAIL = "master.plan-permissions@example.com";
const MASTER_PASSWORD = "master-secret";

const CONSULTANT_LINKED_EMAIL = "consultant.linked@example.com";
const CONSULTANT_LINKED_PASSWORD = "consultant-linked-secret";

const CONSULTANT_UNLINKED_EMAIL = "consultant.unlinked@example.com";
const CONSULTANT_UNLINKED_PASSWORD = "consultant-unlinked-secret";

const CLIENT_EMAIL = "client.pj@example.com";
const CLIENT_PASSWORD = "client-secret";

interface TestContext {
  appServer?: import("http").Server;
  storage: IStorage;
}

async function seedUsers(storage: IStorage) {
  const masterUser: User = {
    userId: "user-master", 
    email: MASTER_EMAIL,
    passwordHash: await bcrypt.hash(MASTER_PASSWORD, 10),
    role: "master",
    name: "Master User",
    organizationId: ORG_ID,
    clientIds: [CLIENT_ID],
    managedConsultantIds: ["user-consultant-linked", "user-consultant-unlinked"],
    managedClientIds: [CLIENT_ID],
  };

  const consultantLinked: User = {
    userId: "user-consultant-linked",
    email: CONSULTANT_LINKED_EMAIL,
    passwordHash: await bcrypt.hash(CONSULTANT_LINKED_PASSWORD, 10),
    role: "consultor",
    name: "Consultor Vinculado",
    organizationId: ORG_ID,
    clientIds: [CLIENT_ID],
    managedConsultantIds: [],
    managedClientIds: [],
    managerId: masterUser.userId,
  };

  const consultantUnlinked: User = {
    userId: "user-consultant-unlinked",
    email: CONSULTANT_UNLINKED_EMAIL,
    passwordHash: await bcrypt.hash(CONSULTANT_UNLINKED_PASSWORD, 10),
    role: "consultor",
    name: "Consultor Não Vinculado",
    organizationId: ORG_ID,
    clientIds: [],
    managedConsultantIds: [],
    managedClientIds: [],
    managerId: masterUser.userId,
  };

  const clientUser: User = {
    userId: "user-client",
    email: CLIENT_EMAIL,
    passwordHash: await bcrypt.hash(CLIENT_PASSWORD, 10),
    role: "cliente",
    name: "Cliente PJ",
    organizationId: ORG_ID,
    clientIds: [CLIENT_ID],
    managedConsultantIds: [],
    managedClientIds: [],
    consultantId: consultantLinked.userId,
    managerId: masterUser.userId,
  };

  await storage.createUser(masterUser);
  await storage.createUser(consultantLinked);
  await storage.createUser(consultantUnlinked);
  await storage.createUser(clientUser);
}

async function seedClient(storage: IStorage) {
  const client: Client = {
    clientId: CLIENT_ID,
    name: "Empresa Permissões",
    type: "PJ",
    email: CLIENT_EMAIL,
    organizationId: ORG_ID,
    consultantId: "user-consultant-linked",
    masterId: "user-master",
  };

  await storage.upsertClient(client);
}

async function login(agent: request.SuperAgentTest, email: string, password: string) {
  return agent.post("/api/auth/login").send({ email, password }).expect(200);
}

describe("PJ plan permission enforcement", () => {
  const ctx: TestContext = { storage: new MemStorage() };

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use(
      session({
        secret: "pj-plan-permissions-test",
        resave: false,
        saveUninitialized: false,
      }),
    );

    app.post("/api/auth/login", async (req, res) => {
      const { email, password } = req.body ?? {};
      if (typeof email !== "string" || typeof password !== "string") {
        res.status(400).json({ error: "Credenciais inválidas" });
        return;
      }

      const user = await ctx.storage.getUserByEmail(email);
      if (!user) {
        res.status(401).json({ error: "Credenciais inválidas" });
        return;
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "Credenciais inválidas" });
        return;
      }

      req.session.userId = user.userId;
      res.json({ ok: true });
    });

    ctx.storage = setStorageProvider(new MemStorage());
    registerPjCategoryRoutes(app);

    ctx.appServer = app.listen(0);
  });

  after(async () => {
    if (ctx.appServer?.listening) {
      await new Promise<void>((resolve, reject) => {
        ctx.appServer!.close(err => (err ? reject(err) : resolve()));
      });
    }
  });

  beforeEach(async () => {
    ctx.storage = setStorageProvider(new MemStorage());
    await seedUsers(ctx.storage);
    await seedClient(ctx.storage);
  });

  it("permite que o master gerencie categorias globais do plano PJ", async () => {
    const agent = request.agent(ctx.appServer!);
    await login(agent, MASTER_EMAIL, MASTER_PASSWORD);

    const createResponse = await agent
      .post("/api/pj/global-categories")
      .send({ code: "MASTER_GLOBAL", name: "Categoria Master" })
      .expect(201);

    assert.equal(createResponse.body.category.code, "MASTER_GLOBAL");

    const categoryId = createResponse.body.category.id as string;

    const updateResponse = await agent
      .patch(`/api/pj/global-categories/${categoryId}`)
      .send({ name: "Categoria Master Atualizada" })
      .expect(200);

    assert.equal(updateResponse.body.category.name, "Categoria Master Atualizada");

    await agent.delete(`/api/pj/global-categories/${categoryId}`).expect(204);
  });

  it("bloqueia consultor no plano global e registra auditoria", async () => {
    const agent = request.agent(ctx.appServer!);
    await login(agent, CONSULTANT_LINKED_EMAIL, CONSULTANT_LINKED_PASSWORD);

    const response = await agent
      .post("/api/pj/global-categories")
      .send({ code: "CONSULTOR", name: "Categoria Consultor" });

    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { error: "Acesso negado" });

    const auditLogs = await ctx.storage.getAuditLogs(ORG_ID);
    const denial = auditLogs.find(entry => entry.eventType === "security.access_denied.pj_plan_global");
    assert.ok(denial, "esperava evento de acesso negado ao plano global");
    assert.equal(denial?.targetType, "pj_plan");
    assert.equal(denial?.metadata?.reason, "master_role_required");
    assert.equal(denial?.metadata?.userRole, "consultor");
  });

  it("permite que o master gerencie o plano do cliente", async () => {
    const agent = request.agent(ctx.appServer!);
    await login(agent, MASTER_EMAIL, MASTER_PASSWORD);

    const createResponse = await agent
      .post(`/api/pj/${CLIENT_ID}/categories`)
      .send({ name: "Categoria Cliente" })
      .expect(201);

    const categoryId = createResponse.body.category.id as string;

    const updateResponse = await agent
      .patch(`/api/pj/${CLIENT_ID}/categories/${categoryId}`)
      .send({ name: "Categoria Cliente Atualizada" })
      .expect(200);

    assert.equal(updateResponse.body.category.name, "Categoria Cliente Atualizada");

    await agent.delete(`/api/pj/${CLIENT_ID}/categories/${categoryId}`).expect(204);
  });

  it("permite que consultor vinculado altere o plano do cliente", async () => {
    const agent = request.agent(ctx.appServer!);
    await login(agent, CONSULTANT_LINKED_EMAIL, CONSULTANT_LINKED_PASSWORD);

    const createResponse = await agent
      .post(`/api/pj/${CLIENT_ID}/categories`)
      .send({ name: "Categoria Consultor" })
      .expect(201);

    const categoryId = createResponse.body.category.id as string;

    await agent
      .patch(`/api/pj/${CLIENT_ID}/categories/${categoryId}`)
      .send({ name: "Categoria Consultor Atualizada" })
      .expect(200);

    await agent.delete(`/api/pj/${CLIENT_ID}/categories/${categoryId}`).expect(204);
  });

  it("bloqueia consultor não vinculado no plano do cliente e audita", async () => {
    const agent = request.agent(ctx.appServer!);
    await login(agent, CONSULTANT_UNLINKED_EMAIL, CONSULTANT_UNLINKED_PASSWORD);

    const response = await agent
      .post(`/api/pj/${CLIENT_ID}/categories`)
      .send({ name: "Categoria Indevida" });

    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { error: "Acesso negado" });

    const auditLogs = await ctx.storage.getAuditLogs(ORG_ID);
    const denial = auditLogs.find(entry => entry.eventType === "security.access_denied.pj_plan_client");
    assert.ok(denial, "esperava evento de acesso negado ao plano do cliente");
    assert.equal(denial?.targetType, "client");
    assert.equal(denial?.targetId, CLIENT_ID);
    assert.equal(denial?.metadata?.reason, "client_not_linked");
    assert.equal(denial?.metadata?.userRole, "consultor");
  });

  it("bloqueia cliente PJ autenticado e registra auditoria", async () => {
    const agent = request.agent(ctx.appServer!);
    await login(agent, CLIENT_EMAIL, CLIENT_PASSWORD);

    const response = await agent
      .post(`/api/pj/${CLIENT_ID}/categories`)
      .send({ name: "Categoria Cliente" });

    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { error: "Acesso negado" });

    const auditLogs = await ctx.storage.getAuditLogs(ORG_ID);
    const denial = auditLogs.find(entry => entry.eventType === "security.access_denied.pj_plan_client");
    assert.ok(denial, "esperava evento de acesso negado registrado");
    assert.equal(denial?.targetType, "client");
    assert.equal(denial?.targetId, CLIENT_ID);
    assert.equal(denial?.metadata?.reason, "role_not_allowed");
    assert.equal(denial?.metadata?.userRole, "cliente");
  });
});

