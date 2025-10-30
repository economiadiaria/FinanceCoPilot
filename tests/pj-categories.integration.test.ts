import { describe, before, after, beforeEach, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import bcrypt from "bcrypt";

import { registerRoutes } from "../server/routes";
import {
  MemStorage,
  setStorageProvider,
  type IStorage,
  type PjClientCategoryRecord,
} from "../server/storage";
import type { Client, PjCategory, User } from "@shared/schema";

const ORG_ID = "org-pj-categories";
const MASTER_USER_ID = "user-master-categories";
const MASTER_EMAIL = "master.categories@example.com";
const MASTER_PASSWORD = "master-categories-secret";
const CONSULTANT_USER_ID = "user-consultant-categories";
const CONSULTANT_EMAIL = "consultant.categories@example.com";
const CONSULTANT_PASSWORD = "consultant-categories-secret";
const OTHER_CONSULTANT_USER_ID = "user-consultant-unlinked";
const OTHER_CONSULTANT_EMAIL = "other.consultant@example.com";
const OTHER_CONSULTANT_PASSWORD = "other-consultant-secret";
const CLIENT_ID = "client-pj-categories";

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
    name: "Master Categories",
    organizationId: ORG_ID,
    clientIds: [CLIENT_ID],
    managedConsultantIds: [CONSULTANT_USER_ID, OTHER_CONSULTANT_USER_ID],
    managedClientIds: [CLIENT_ID],
  };

  const consultant: User = {
    userId: CONSULTANT_USER_ID,
    email: CONSULTANT_EMAIL,
    passwordHash: await bcrypt.hash(CONSULTANT_PASSWORD, 10),
    role: "consultor",
    name: "Consultant Categories",
    organizationId: ORG_ID,
    clientIds: [CLIENT_ID],
    managedConsultantIds: [],
    managedClientIds: [CLIENT_ID],
    managerId: MASTER_USER_ID,
  };

  const otherConsultant: User = {
    userId: OTHER_CONSULTANT_USER_ID,
    email: OTHER_CONSULTANT_EMAIL,
    passwordHash: await bcrypt.hash(OTHER_CONSULTANT_PASSWORD, 10),
    role: "consultor",
    name: "Consultant Unlinked",
    organizationId: ORG_ID,
    clientIds: [],
    managedConsultantIds: [],
    managedClientIds: [],
    managerId: MASTER_USER_ID,
  };

  await storage.createUser(masterUser);
  await storage.createUser(consultant);
  await storage.createUser(otherConsultant);
}

async function seedClient(storage: IStorage) {
  const client: Client = {
    clientId: CLIENT_ID,
    name: "Empresa Categorias",
    type: "PJ",
    email: "empresa.categorias@example.com",
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

async function login(agent: request.SuperAgentTest, email: string, password: string) {
  await agent.post("/api/auth/login").send({ email, password }).expect(200);
}

describe("PJ category routes", () => {
  const ctx: TestContext = { storage: new MemStorage() };

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use(
      session({
        secret: "pj-categories-secret",
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
    const globalCategories = await ctx.storage.getPjCategories();
    await seedClientCategories(ctx.storage, globalCategories.slice(0, 1));
  });

  it("lista categorias globais ordenadas e em árvore", async () => {
    const agent = request.agent(ctx.appServer!);
    await login(agent, MASTER_EMAIL, MASTER_PASSWORD);

    const listResponse = await agent.get("/api/pj/global-categories").expect(200);
    assert.equal(listResponse.body.type, "global");
    const categories = listResponse.body.categories as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(categories));
    assert.equal(categories.every(category => Array.isArray(category.children) && category.children.length === 0), true);

    const treeResponse = await agent
      .get("/api/pj/global-categories")
      .query({ tree: "true" })
      .expect(200);
    assert.equal(treeResponse.body.type, "global");
    const tree = treeResponse.body.categories as Array<Record<string, unknown>>;
    assert.ok(tree.length >= 1);
    const sortedOrder = [...tree].map(node => node.sortOrder as number);
    assert.deepEqual(sortedOrder, [...sortedOrder].sort((a, b) => a - b));
  });

  it("bloqueia criação de categoria global para consultores", async () => {
    const agent = request.agent(ctx.appServer!);
    await login(agent, CONSULTANT_EMAIL, CONSULTANT_PASSWORD);

    const response = await agent
      .post("/api/pj/global-categories")
      .send({ code: "CONSULTOR_CAT", name: "Categoria" })
      .expect(403);

    assert.equal(response.body.error, "Acesso negado");
  });

  it("cria categorias globais e evita duplicidades", async () => {
    const agent = request.agent(ctx.appServer!);
    await login(agent, MASTER_EMAIL, MASTER_PASSWORD);

    const createResponse = await agent
      .post("/api/pj/global-categories")
      .send({ code: "CUSTOM_GLOBAL", name: "Categoria Custom" })
      .expect(201);

    assert.equal(createResponse.body.category.code, "CUSTOM_GLOBAL");

    await agent
      .post("/api/pj/global-categories")
      .send({ code: "CUSTOM_GLOBAL", name: "Duplicada" })
      .expect(409);
  });

  it("impede ciclos na hierarquia global", async () => {
    const agent = request.agent(ctx.appServer!);
    await login(agent, MASTER_EMAIL, MASTER_PASSWORD);

    const parentResponse = await agent
      .post("/api/pj/global-categories")
      .send({ code: "PARENT", name: "Categoria Pai" })
      .expect(201);

    const parentId = parentResponse.body.category.id as string;

    const childResponse = await agent
      .post("/api/pj/global-categories")
      .send({ code: "CHILD", name: "Categoria Filha", parentId })
      .expect(201);

    const childId = childResponse.body.category.id as string;

    const cycleResponse = await agent
      .patch(`/api/pj/global-categories/${parentId}`)
      .send({ parentId: childId })
      .expect(400);

    assert.equal(cycleResponse.body.error.includes("ciclo"), true);
  });

  it("bloqueia alterações em categorias globais núcleo", async () => {
    const agent = request.agent(ctx.appServer!);
    await login(agent, MASTER_EMAIL, MASTER_PASSWORD);

    const coreCategory = (await ctx.storage.getPjCategories())[0];

    const response = await agent
      .patch(`/api/pj/global-categories/${coreCategory.id}`)
      .send({ name: `${coreCategory.name} Atualizada` })
      .expect(403);

    assert.equal(response.body.error, "Categorias núcleo não podem ser alteradas");
  });

  it("remove categorias globais sem dependências", async () => {
    const agent = request.agent(ctx.appServer!);
    await login(agent, MASTER_EMAIL, MASTER_PASSWORD);

    const createResponse = await agent
      .post("/api/pj/global-categories")
      .send({ code: "REMOVER", name: "Categoria Transitória" })
      .expect(201);

    const categoryId = createResponse.body.category.id as string;

    await agent.delete(`/api/pj/global-categories/${categoryId}`).expect(204);

    const categories = await ctx.storage.getPjCategories();
    assert.equal(categories.some(category => category.id === categoryId), false);
  });

  it("lista categorias de cliente como árvore ordenada", async () => {
    const agent = request.agent(ctx.appServer!);
    await login(agent, MASTER_EMAIL, MASTER_PASSWORD);

    const response = await agent
      .get(`/api/pj/${CLIENT_ID}/categories`)
      .query({ tree: "true" })
      .expect(200);

    assert.equal(response.body.type, "client");
    const nodes = response.body.categories as Array<Record<string, unknown>>;
    assert.ok(nodes.length >= 1);
    const order = nodes.map(node => node.sortOrder as number);
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
  });

  it("propaga base_category_id ao criar categoria de cliente", async () => {
    const agent = request.agent(ctx.appServer!);
    await login(agent, MASTER_EMAIL, MASTER_PASSWORD);

    const baseCategory = (await ctx.storage.getPjCategories())[0];

    const createResponse = await agent
      .post(`/api/pj/${CLIENT_ID}/categories`)
      .send({
        name: "Categoria Custom Cliente",
        baseCategoryId: baseCategory.id,
      })
      .expect(201);

    const categoryId = createResponse.body.category.id as string;

    const stored = (await ctx.storage.getPjClientCategories(ORG_ID, CLIENT_ID)) as PjClientCategoryRecord[];
    const created = stored.find(category => category.id === categoryId);
    assert.ok(created);
    assert.equal(created?.baseCategoryId, baseCategory.id);
  });

  it("bloqueia alterações e remoções em categorias de cliente núcleo", async () => {
    const agent = request.agent(ctx.appServer!);
    await login(agent, MASTER_EMAIL, MASTER_PASSWORD);

    const existing = (await ctx.storage.getPjClientCategories(ORG_ID, CLIENT_ID)) as PjClientCategoryRecord[];
    const coreCategory = existing[0];

    const updateResponse = await agent
      .patch(`/api/pj/${CLIENT_ID}/categories/${coreCategory.id}`)
      .send({ name: `${coreCategory.name} Atualizada` })
      .expect(403);
    assert.equal(updateResponse.body.error, "Categorias núcleo não podem ser alteradas");

    const deleteResponse = await agent
      .delete(`/api/pj/${CLIENT_ID}/categories/${coreCategory.id}`)
      .expect(403);
    assert.equal(deleteResponse.body.error, "Categorias núcleo não podem ser removidas");
  });

  it("impede ciclos na hierarquia de categorias do cliente", async () => {
    const agent = request.agent(ctx.appServer!);
    await login(agent, MASTER_EMAIL, MASTER_PASSWORD);

    const first = await agent
      .post(`/api/pj/${CLIENT_ID}/categories`)
      .send({ name: "Pai Cliente" })
      .expect(201);
    const parentId = first.body.category.id as string;

    const second = await agent
      .post(`/api/pj/${CLIENT_ID}/categories`)
      .send({ name: "Filho Cliente", parentId })
      .expect(201);
    const childId = second.body.category.id as string;

    const response = await agent
      .patch(`/api/pj/${CLIENT_ID}/categories/${parentId}`)
      .send({ parentId: childId })
      .expect(400);

    assert.equal(response.body.error.includes("ciclo"), true);
  });

  it("retorna 404 ao editar categoria de cliente inexistente", async () => {
    const agent = request.agent(ctx.appServer!);
    await login(agent, MASTER_EMAIL, MASTER_PASSWORD);

    await agent
      .patch(`/api/pj/${CLIENT_ID}/categories/inexistente`)
      .send({ name: "Qualquer" })
      .expect(404);
  });

  it("nega acesso a consultores não vinculados", async () => {
    const agent = request.agent(ctx.appServer!);
    await login(agent, OTHER_CONSULTANT_EMAIL, OTHER_CONSULTANT_PASSWORD);

    const response = await agent.get(`/api/pj/${CLIENT_ID}/categories`).expect(403);
    assert.equal(response.body.error, "Acesso negado");
  });
});
