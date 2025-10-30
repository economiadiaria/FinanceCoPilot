import { describe, before, after, beforeEach, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import bcrypt from "bcrypt";

import { registerRoutes } from "../server/routes";
import { MemStorage, setStorageProvider, type IStorage, type PjClientCategoryRecord } from "../server/storage";
import type { Client, PjCategory, User } from "@shared/schema";

const ORG_ID = "org-plan-categories";
const MASTER_USER_ID = "user-master-plan-categories";
const MASTER_EMAIL = "master.plan.categories@example.com";
const MASTER_PASSWORD = "master-plan-categories-secret";
const CONSULTANT_USER_ID = "user-consultant-plan-categories";
const CONSULTANT_EMAIL = "consultant.plan.categories@example.com";
const CONSULTANT_PASSWORD = "consultant-plan-categories-secret";
const CLIENT_ID = "client-plan-categories";
const TEST_DATABASE_URL = "postgresql://test-user:secret@localhost:5432/plan_categories";
const TEST_DATABASE_DRIVER = "pg";

interface TestContext {
  storage: IStorage;
  appServer?: import("http").Server;
}

async function seedUsers(storage: IStorage) {
  const masterUser: User = {
    userId: MASTER_USER_ID,
    email: MASTER_EMAIL,
    passwordHash: await bcrypt.hash(MASTER_PASSWORD, 10),
    role: "master",
    name: "Master Plan Categories",
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
    name: "Consultant Plan Categories",
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
    name: "Cliente Plano Categorias",
    type: "PJ",
    email: "cliente.plan.categories@example.com",
    organizationId: ORG_ID,
    consultantId: CONSULTANT_USER_ID,
    masterId: MASTER_USER_ID,
  };

  await storage.upsertClient(client);
}

async function seedClientCategories(storage: IStorage, baseCategories: PjCategory[]) {
  const now = new Date().toISOString();
  const records: PjClientCategoryRecord[] = baseCategories.map((category, index) => ({
    id: `${CLIENT_ID}-${category.id}-${index}`,
    orgId: ORG_ID,
    clientId: CLIENT_ID,
    baseCategoryId: category.id,
    name: category.name,
    description: category.description ?? null,
    parentId: null,
    acceptsPostings: category.acceptsPostings,
    level: 0,
    path: `${CLIENT_ID}.${category.id}`,
    sortOrder: (index + 1) * 10,
    createdAt: now,
    updatedAt: now,
  }));

  await storage.setPjClientCategories(ORG_ID, CLIENT_ID, records);
}

async function login(agent: request.SuperAgentTest) {
  await agent.post("/api/auth/login").send({ email: MASTER_EMAIL, password: MASTER_PASSWORD }).expect(200);
}

function expectTree(nodes: Array<Record<string, unknown>>) {
  assert.ok(Array.isArray(nodes));
  for (const node of nodes) {
    assert.ok(Array.isArray(node.children));
    if (node.children.length > 0) {
      expectTree(node.children as Array<Record<string, unknown>>);
    }
  }
}

function normalizeName(value: unknown) {
  assert.equal(typeof value, "string");
  return String(value);
}

function findNodeByName(nodes: Array<Record<string, unknown>>, name: string): Record<string, unknown> | undefined {
  for (const node of nodes) {
    if (node.name === name) {
      return node;
    }
    const found = findNodeByName(node.children as Array<Record<string, unknown>>, name);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function assertIncludesCycleError(message: unknown) {
  assert.equal(typeof message, "string");
  assert.ok(String(message).toLowerCase().includes("ciclo"));
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

describe("PJ plan categories routes", () => {
  const ctx: TestContext = { storage: new MemStorage() };
  let originalDatabaseUrl: string | undefined;
  let originalDatabaseDriver: string | undefined;

  before(async () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    originalDatabaseDriver = process.env.DATABASE_DRIVER;
    if (!process.env.DATABASE_URL) {
      process.env.DATABASE_URL = TEST_DATABASE_URL;
    }
    if (!process.env.DATABASE_DRIVER) {
      process.env.DATABASE_DRIVER = TEST_DATABASE_DRIVER;
    }

    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use(
      session({
        secret: "pj-plan-categories-secret",
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
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    if (originalDatabaseDriver === undefined) {
      delete process.env.DATABASE_DRIVER;
    } else {
      process.env.DATABASE_DRIVER = originalDatabaseDriver;
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

  it("executa CRUD de categorias globais em árvore e bloqueia nomes duplicados", async () => {
    const agent = request.agent(ctx.appServer!);
    await login(agent);

    const treeResponse = await agent.get("/api/pj/global-categories").query({ tree: "true" }).expect(200);
    assert.equal(treeResponse.body.type, "global");
    expectTree(treeResponse.body.categories);

    const createResponse = await agent
      .post("/api/pj/global-categories")
      .send({ code: "PLAN_CUSTOM", name: "Categoria Plano" })
      .expect(201);

    const created = createResponse.body.category as Record<string, unknown>;
    const categoryId = normalizeName(created.id);
    assert.equal(normalizeName(created.name), "Categoria Plano");
    assert.equal(created.isCore, false);

    await agent
      .post("/api/pj/global-categories")
      .send({ code: "PLAN_DUPLICATE", name: "Categoria Plano" })
      .expect(409);

    const updateResponse = await agent
      .patch(`/api/pj/global-categories/${categoryId}`)
      .send({ name: "Categoria Plano Atualizada" })
      .expect(200);

    assert.equal(updateResponse.body.category.isCore, false);
    assert.equal(updateResponse.body.category.name, "Categoria Plano Atualizada");

    await agent
      .patch(`/api/pj/global-categories/${categoryId}`)
      .send({ name: "Receitas" })
      .expect(409);

    await agent.delete(`/api/pj/global-categories/${categoryId}`).expect(204);
  });

  it("executa operações de categorias de cliente, preserva base_category_id e evita ciclos", async () => {
    const agent = request.agent(ctx.appServer!);
    await login(agent);

    const baseGlobalResponse = await agent
      .post("/api/pj/global-categories")
      .send({ code: "CLIENT_BASE", name: "Base Categoria Cliente" })
      .expect(201);

    const baseCategoryId = normalizeName(baseGlobalResponse.body.category.id);

    const baseCreateResponse = await agent
      .post(`/api/pj/${CLIENT_ID}/categories`)
      .send({ name: "Categoria Cliente", baseCategoryId })
      .expect(201);

    const baseCategoryNode = baseCreateResponse.body.category as Record<string, unknown>;
    const baseCategoryNodeId = normalizeName(baseCategoryNode.id);
    assert.equal(baseCategoryNode.baseCategoryId, baseCategoryId);

    await agent
      .post(`/api/pj/${CLIENT_ID}/categories`)
      .send({ name: "Categoria Cliente" })
      .expect(409);

    const customParentResponse = await agent
      .post(`/api/pj/${CLIENT_ID}/categories`)
      .send({ name: "Categoria Custom" })
      .expect(201);

    const customParentId = normalizeName(customParentResponse.body.category.id);

    const childResponse = await agent
      .post(`/api/pj/${CLIENT_ID}/categories`)
      .send({ name: "Categoria Filha", parentId: customParentId })
      .expect(201);

    const childId = normalizeName(childResponse.body.category.id);

    const cycleResponse = await agent
      .patch(`/api/pj/${CLIENT_ID}/categories/${customParentId}`)
      .send({ parentId: childId })
      .expect(400);

    assertIncludesCycleError(cycleResponse.body.error);

    const updateResponse = await agent
      .patch(`/api/pj/${CLIENT_ID}/categories/${baseCategoryNodeId}`)
      .send({ name: "Categoria Cliente Atualizada" })
      .expect(200);

    assert.equal(updateResponse.body.category.baseCategoryId, baseCategoryId);

    await agent
      .patch(`/api/pj/${CLIENT_ID}/categories/${baseCategoryNodeId}`)
      .send({ name: "Categoria Filha" })
      .expect(409);

    const treeResponse = await agent
      .get(`/api/pj/${CLIENT_ID}/categories`)
      .query({ tree: "true" })
      .expect(200);

    assert.equal(treeResponse.body.type, "client");
    expectTree(treeResponse.body.categories);
    const found = findNodeByName(treeResponse.body.categories, "Categoria Cliente Atualizada");
    assert.ok(found, "updated client category should be present in tree response");
    assert.equal(normalize(found!.baseCategoryId as string), normalize(baseCategoryId));

    await agent.delete(`/api/pj/${CLIENT_ID}/categories/${childId}`).expect(204);
  });
});
