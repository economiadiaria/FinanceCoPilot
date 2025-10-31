import { describe, before, after, beforeEach, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import bcrypt from "bcrypt";

import { registerRoutes } from "../server/routes";
import { MemStorage, setStorageProvider } from "../server/storage";
import type { IStorage, PjClientCategoryRecord } from "../server/storage";
import type { Client, User, PjCategory } from "@shared/schema";

const ORG_ID = "org-plan-tests";
const MASTER_USER_ID = "user-master-plan";
const MASTER_EMAIL = "master.plan@example.com";
const MASTER_PASSWORD = "master-plan-secret";
const CONSULTANT_USER_ID = "user-consultant-plan";
const CONSULTANT_EMAIL = "consultant.plan@example.com";
const CONSULTANT_PASSWORD = "consultant-plan-secret";
const CLIENT_ID = "client-plan-tests";

interface TestContext {
  appServer?: import("http").Server;
  storage: IStorage;
}

function assertMaskedName(original: string, masked: unknown, message: string) {
  assert.equal(typeof masked, "string", message);
  const maskedName = masked as string;
  if (original.length <= 2) {
    assert.equal(maskedName, "**", message);
    return;
  }
  assert.equal(maskedName.length, original.length, message);
  assert.equal(maskedName.at(0), original.at(0), message);
  assert.equal(maskedName.at(-1), original.at(-1), message);
  assert.match(maskedName.slice(1, -1), /^[*]+$/, message);
}

async function seedUsers(storage: IStorage) {
  const masterUser: User = {
    userId: MASTER_USER_ID,
    email: MASTER_EMAIL,
    passwordHash: await bcrypt.hash(MASTER_PASSWORD, 10),
    role: "master",
    name: "Master Plan",
    organizationId: ORG_ID,
    clientIds: [CLIENT_ID],
    managedConsultantIds: [CONSULTANT_USER_ID],
    managedClientIds: [CLIENT_ID],
  };

  const consultantUser: User = {
    userId: CONSULTANT_USER_ID,
    email: CONSULTANT_EMAIL,
    passwordHash: await bcrypt.hash(CONSULTANT_PASSWORD, 10),
    role: "consultor",
    name: "Consultor Plan",
    organizationId: ORG_ID,
    clientIds: [CLIENT_ID],
    managedConsultantIds: [],
    managedClientIds: [CLIENT_ID],
    managerId: MASTER_USER_ID,
  };

  await storage.createUser(masterUser);
  await storage.createUser(consultantUser);
}

async function seedClient(storage: IStorage) {
  const client: Client = {
    clientId: CLIENT_ID,
    name: "Cliente Plano",
    type: "PJ",
    email: "cliente.plan@example.com",
    organizationId: ORG_ID,
    consultantId: CONSULTANT_USER_ID,
    masterId: MASTER_USER_ID,
  };

  await storage.upsertClient(client);
}

async function seedClientCategories(storage: IStorage, baseCategories: PjCategory[]) {
  const now = new Date().toISOString();
  const records: PjClientCategoryRecord[] = baseCategories.map(category => ({
    id: `${CLIENT_ID}-${category.id}`,
    orgId: ORG_ID,
    clientId: CLIENT_ID,
    baseCategoryId: category.id,
    name: category.name,
    description: category.description ?? null,
    parentId: null,
    acceptsPostings: category.acceptsPostings,
    level: 0,
    path: `${CLIENT_ID}.${category.id}`,
    sortOrder: category.sortOrder,
    createdAt: now,
    updatedAt: now,
  }));

  await storage.setPjClientCategories(ORG_ID, CLIENT_ID, records);
}

describe("PJ plan routes", () => {
  const ctx: TestContext = { storage: new MemStorage() };

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use(
      session({
        secret: "plan-tests-secret",
        resave: false,
        saveUninitialized: false,
      }),
    );

    ctx.storage = new MemStorage();
    setStorageProvider(ctx.storage);

    ctx.appServer = await registerRoutes(app);
  });

  after(async () => {
    if (ctx.appServer?.listening) {
      await new Promise<void>((resolve, reject) => {
        ctx.appServer!.close(err => (err ? reject(err) : resolve()));
      });
    }
  });

  beforeEach(async () => {
    ctx.storage = new MemStorage();
    setStorageProvider(ctx.storage);
    await seedUsers(ctx.storage);
    await seedClient(ctx.storage);

    const baseCategories = await ctx.storage.getPjCategories();
    await seedClientCategories(ctx.storage, baseCategories.slice(0, 1));
  });

  it("bloqueia atualizações em categorias globais core", async () => {
    const agent = request.agent(ctx.appServer!);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_EMAIL, password: MASTER_PASSWORD })
      .expect(200);

    const baseCategories = await ctx.storage.getPjCategories();
    const coreCategory = baseCategories[0];

    const response = await agent
      .patch(`/api/pj/plan/global/${coreCategory.id}`)
      .send({ name: `${coreCategory.name} Atualizado` })
      .expect(403);

    assert.equal(response.body.error, "Categorias núcleo não podem ser alteradas");
  });

  it("registra auditoria ao atualizar categoria global não core", async () => {
    const agent = request.agent(ctx.appServer!);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_EMAIL, password: MASTER_PASSWORD })
      .expect(200);

    const createResponse = await agent
      .post("/api/pj/plan/global")
      .set("X-Request-Id", "req-plan-create-1")
      .send({
        code: "CUSTOM_CAT",
        name: "Categoria Custom",
      })
      .expect(201);

    const categoryId = createResponse.body.category.id as string;
    assert.equal(createResponse.headers["x-request-id"], "req-plan-create-1");

    const updateResponse = await agent
      .patch(`/api/pj/plan/global/${categoryId}`)
      .set("X-Request-Id", "req-plan-update-1")
      .send({ name: "Categoria Custom Atualizada" })
      .expect(200);

    assert.equal(updateResponse.headers["x-request-id"], "req-plan-update-1");

    const logs = await ctx.storage.getAuditLogs(ORG_ID, 5);
    const latest = logs.find(entry => entry.eventType === "pj.plan.global.update");
    assert.ok(latest, "audit log for global update should exist");
    assert.equal(latest?.metadata?.action, "update");
    const newCategory = latest?.metadata?.new as Record<string, unknown> | undefined;
    const oldCategory = latest?.metadata?.old as Record<string, unknown> | undefined;
    assert.ok(newCategory, "sanitized new category should be present in audit metadata");
    assert.ok(oldCategory, "sanitized old category should be present in audit metadata");
    assert.equal(newCategory?.code, "CUSTOM_CAT");
    assert.equal(oldCategory?.code, "CUSTOM_CAT");
    assertMaskedName(
      "Categoria Custom Atualizada",
      newCategory?.name,
      "new category name should be masked",
    );
    assertMaskedName(
      "Categoria Custom",
      oldCategory?.name,
      "old category name should be masked",
    );
    assert.equal(latest?.metadata?.requestId, "req-plan-update-1");
  });

  it("bloqueia atualização em categoria de cliente derivada de núcleo", async () => {
    const agent = request.agent(ctx.appServer!);
    await agent
      .post("/api/auth/login")
      .send({ email: CONSULTANT_EMAIL, password: CONSULTANT_PASSWORD })
      .expect(200);

    const categories = await ctx.storage.getPjClientCategories(ORG_ID, CLIENT_ID);
    const coreDerived = categories[0];

    const response = await agent
      .patch(`/api/pj/plan/client/${CLIENT_ID}/${coreDerived.id}`)
      .send({ name: `${coreDerived.name} Atualizado` })
      .expect(403);

    assert.equal(response.body.error, "Categorias núcleo não podem ser alteradas");
  });

  it("permite atualizar categoria de cliente customizada com auditoria", async () => {
    const agent = request.agent(ctx.appServer!);
    await agent
      .post("/api/auth/login")
      .send({ email: CONSULTANT_EMAIL, password: CONSULTANT_PASSWORD })
      .expect(200);

    const createResponse = await agent
      .post(`/api/pj/plan/client/${CLIENT_ID}`)
      .send({
        name: "Categoria Cliente",
        description: "Categoria Customizada",
      })
      .expect(201);

    const categoryId = createResponse.body.category.id as string;

    await agent
      .patch(`/api/pj/plan/client/${CLIENT_ID}/${categoryId}`)
      .send({ name: "Categoria Cliente Atualizada" })
      .expect(200);

    const logs = await ctx.storage.getAuditLogs(ORG_ID, 10);
    const latest = logs.find(entry => entry.eventType === "pj.plan.client.update" && entry.targetId === categoryId);
    assert.ok(latest, "audit log for client plan update should exist");
    assert.equal(latest?.metadata?.action, "update");
    assert.equal((latest?.metadata?.clientId as string), CLIENT_ID);
    const newCategory = latest?.metadata?.new as Record<string, unknown> | undefined;
    const oldCategory = latest?.metadata?.old as Record<string, unknown> | undefined;
    assert.ok(newCategory, "sanitized new client category should be present in audit metadata");
    assert.ok(oldCategory, "sanitized old client category should be present in audit metadata");
    assertMaskedName(
      "Categoria Cliente Atualizada",
      newCategory?.name,
      "new client category name should be masked",
    );
    assertMaskedName(
      "Categoria Cliente",
      oldCategory?.name,
      "old client category name should be masked",
    );
  });
});
