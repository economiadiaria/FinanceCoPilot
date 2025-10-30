import { describe, before, after, beforeEach, afterEach, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import bcrypt from "bcrypt";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { asc, eq } from "drizzle-orm";

import { registerRoutes } from "../server/routes";
import {
  MemStorage,
  setStorageProvider,
  type IStorage,
  type PjClientCategoryRecord,
} from "../server/storage";
import type { Database } from "../server/db/client";
import { pjCategories, pjClientCategories } from "../server/db/schema";
import type { User, PjCategory } from "@shared/schema";

const ORG_ID = "org-pj-onboarding";
const MASTER_USER_ID = "user-master-onboarding";
const MASTER_EMAIL = "master.onboarding@example.com";
const MASTER_PASSWORD = "master-onboarding-secret";

const BASE_ROOT_ID = "11111111-1111-1111-1111-111111111111";
const BASE_CHILD_ID = "22222222-2222-2222-2222-222222222222";
const BASE_SECOND_ROOT_ID = "33333333-3333-3333-3333-333333333333";

interface TestContext {
  storage: IStorage;
  pg: PGlite;
  db: Database;
  appServer?: import("http").Server;
}

async function seedStorage(storage: IStorage) {
  const masterUser: User = {
    userId: MASTER_USER_ID,
    email: MASTER_EMAIL,
    passwordHash: await bcrypt.hash(MASTER_PASSWORD, 10),
    role: "master",
    name: "Master Onboarding",
    organizationId: ORG_ID,
    clientIds: [],
    managedConsultantIds: [],
    managedClientIds: [],
  };

  await storage.createUser(masterUser);
}

async function ensureTestTables(pg: PGlite) {
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS pj_categories (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      parent_id TEXT,
      is_core BOOLEAN NOT NULL,
      accepts_postings BOOLEAN NOT NULL,
      level INTEGER NOT NULL,
      path TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pg.exec(`
    CREATE TABLE IF NOT EXISTS pj_client_categories (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      base_category_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      parent_id TEXT,
      level INTEGER NOT NULL,
      path TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      accepts_postings BOOLEAN NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

const BASE_CATEGORIES: Array<Omit<PjCategory, "createdAt" | "updatedAt"> & {
  createdAt?: string;
  updatedAt?: string;
}> = [
  {
    id: BASE_ROOT_ID,
    code: "REVENUE",
    name: "Receita",
    description: "Receitas totais",
    parentId: null,
    isCore: true,
    acceptsPostings: false,
    level: 0,
    path: "REVENUE",
    sortOrder: 10,
  },
  {
    id: BASE_CHILD_ID,
    code: "REVENUE_SERVICES",
    name: "Receita de Serviços",
    description: "Serviços prestados",
    parentId: BASE_ROOT_ID,
    isCore: true,
    acceptsPostings: true,
    level: 1,
    path: "REVENUE.REVENUE_SERVICES",
    sortOrder: 20,
  },
  {
    id: BASE_SECOND_ROOT_ID,
    code: "EXPENSES",
    name: "Despesas",
    description: "Despesas totais",
    parentId: null,
    isCore: true,
    acceptsPostings: false,
    level: 0,
    path: "EXPENSES",
    sortOrder: 30,
  },
];

async function resetDatabase(db: Database, storage: IStorage) {
  await db.delete(pjClientCategories);
  await db.delete(pjCategories);

  await db.insert(pjCategories).values(
    BASE_CATEGORIES.map(category => ({
      id: category.id,
      code: category.code,
      name: category.name,
      description: category.description,
      parentId: category.parentId,
      isCore: category.isCore,
      acceptsPostings: category.acceptsPostings,
      level: category.level,
      path: category.path,
      sortOrder: category.sortOrder,
      createdAt: category.createdAt ?? new Date().toISOString(),
      updatedAt: category.updatedAt ?? new Date().toISOString(),
    })),
  );

  await storage.setPjCategories(
    BASE_CATEGORIES.map(category => ({
      ...category,
      createdAt: category.createdAt ?? new Date().toISOString(),
      updatedAt: category.updatedAt ?? new Date().toISOString(),
    })),
  );
}

function selectClientCategories(db: Database, clientId: string) {
  return db
    .select({
      id: pjClientCategories.id,
      orgId: pjClientCategories.orgId,
      clientId: pjClientCategories.clientId,
      baseCategoryId: pjClientCategories.baseCategoryId,
      parentId: pjClientCategories.parentId,
      name: pjClientCategories.name,
      description: pjClientCategories.description,
      acceptsPostings: pjClientCategories.acceptsPostings,
      level: pjClientCategories.level,
      path: pjClientCategories.path,
      sortOrder: pjClientCategories.sortOrder,
      createdAt: pjClientCategories.createdAt,
      updatedAt: pjClientCategories.updatedAt,
    })
    .from(pjClientCategories)
    .where(eq(pjClientCategories.clientId, clientId))
    .orderBy(
      asc(pjClientCategories.level),
      asc(pjClientCategories.sortOrder),
      asc(pjClientCategories.id),
    );
}

function stripCategoryExtras<T extends { createdAt: Date | string; updatedAt: Date | string }>(
  category: T & { name?: unknown; description?: unknown; acceptsPostings?: unknown },
): Omit<T, "name" | "description" | "acceptsPostings"> & { createdAt: string; updatedAt: string } {
  const {
    name: _name,
    description: _description,
    acceptsPostings: _acceptsPostings,
    createdAt,
    updatedAt,
    ...rest
  } = category;

  return {
    ...(rest as Omit<T, "name" | "description" | "acceptsPostings" | "createdAt" | "updatedAt">),
    createdAt: new Date(createdAt as string | number | Date).toISOString(),
    updatedAt: new Date(updatedAt as string | number | Date).toISOString(),
  } as Omit<T, "name" | "description" | "acceptsPostings"> & { createdAt: string; updatedAt: string };
}

function normalizeForComparison(
  categories: Array<PjClientCategoryRecord & { baseCategoryId: string | null }>,
) {
  return categories
    .map(stripCategoryExtras)
    .sort((a, b) => {
      const baseCompare = (a.baseCategoryId ?? "").localeCompare(b.baseCategoryId ?? "");
      if (baseCompare !== 0) {
        return baseCompare;
      }
      return a.id.localeCompare(b.id);
    });
}

describe("/api/client/upsert PJ onboarding", () => {
  const ctx: TestContext = {
    storage: new MemStorage(),
    pg: null as unknown as PGlite,
    db: null as unknown as Database,
  };

  before(async () => {
    ctx.pg = new PGlite();
    await ensureTestTables(ctx.pg);
    ctx.db = drizzle(ctx.pg, { schema: { pjCategories, pjClientCategories } }) as unknown as Database;

    ctx.storage = new MemStorage();
    setStorageProvider(ctx.storage);
    await seedStorage(ctx.storage);
    await resetDatabase(ctx.db, ctx.storage);

    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use(
      session({
        secret: "test-secret",
        resave: false,
        saveUninitialized: false,
      }),
    );

    ctx.appServer = await registerRoutes(app, { db: ctx.db });
  });

  after(async () => {
    if (ctx.appServer?.listening) {
      await new Promise<void>((resolve, reject) => {
        ctx.appServer!.close(err => (err ? reject(err) : resolve()));
      });
    }
    await ctx.pg.close();
  });

  beforeEach(async () => {
    ctx.storage = new MemStorage();
    setStorageProvider(ctx.storage);
    await seedStorage(ctx.storage);
    await resetDatabase(ctx.db, ctx.storage);
  });

  afterEach(async () => {
    await ctx.pg.exec("DELETE FROM pj_client_categories");
  });

  it("clona todas as categorias globais com base_category_id consistente ao criar cliente PJ", async () => {
    const agent = request.agent(ctx.appServer!);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_EMAIL, password: MASTER_PASSWORD })
      .expect(200);

    const clientId = "pj-client-upsert";
    const response = await agent
      .post("/api/client/upsert")
      .send({
        clientId,
        name: "Empresa Upsert",
        type: "PJ",
        email: "empresa@upsert.example.com",
        organizationId: ORG_ID,
      })
      .expect(200);

    assert.equal(response.body.clientId, clientId);

    const inserted = await selectClientCategories(ctx.db, clientId);
    assert.equal(inserted.length, BASE_CATEGORIES.length);

    const baseIds = new Set(inserted.map(category => category.baseCategoryId));
    assert.deepEqual(baseIds, new Set(BASE_CATEGORIES.map(category => category.id)));

    for (const category of inserted) {
      assert.ok(category.baseCategoryId, "categoria do cliente deve referenciar categoria base");
      const base = BASE_CATEGORIES.find(item => item.id === category.baseCategoryId);
      assert.ok(base, `categoria base ${category.baseCategoryId} deve existir`);
      if (base?.parentId) {
        const parent = inserted.find(item => item.id === category.parentId);
        assert.ok(parent, "categoria clonada deve manter hierarquia");
      }
    }

    const stored = await ctx.storage.getPjClientCategories(ORG_ID, clientId);
    assert.equal(stored.length, inserted.length);
    assert.deepEqual(
      normalizeForComparison(stored),
      normalizeForComparison(inserted as PjClientCategoryRecord[]),
    );
  });

  it("é idempotente ao reexecutar upsert para cliente PJ existente", async () => {
    const agent = request.agent(ctx.appServer!);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_EMAIL, password: MASTER_PASSWORD })
      .expect(200);

    const clientId = "pj-client-idempotent";
    await agent
      .post("/api/client/upsert")
      .send({
        clientId,
        name: "Empresa Original",
        type: "PJ",
        email: "original@upsert.example.com",
        organizationId: ORG_ID,
      })
      .expect(200);

    await agent
      .post("/api/client/upsert")
      .send({
        clientId,
        name: "Empresa Atualizada",
        type: "PJ",
        email: "atualizada@upsert.example.com",
        organizationId: ORG_ID,
      })
      .expect(200);

    const categories = await selectClientCategories(ctx.db, clientId);
    assert.equal(categories.length, BASE_CATEGORIES.length);

    const duplicates = new Set(categories.map(category => category.baseCategoryId));
    assert.equal(duplicates.size, categories.length, "categorias base não devem duplicar");

    const stored = await ctx.storage.getPjClientCategories(ORG_ID, clientId);
    assert.deepEqual(
      normalizeForComparison(stored),
      normalizeForComparison(categories as PjClientCategoryRecord[]),
    );
  });

  it("não clona categorias para cliente PF e só clona quando tipo inclui PJ", async () => {
    const agent = request.agent(ctx.appServer!);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_EMAIL, password: MASTER_PASSWORD })
      .expect(200);

    const pfClientId = "pf-client-upsert";
    await agent
      .post("/api/client/upsert")
      .send({
        clientId: pfClientId,
        name: "Pessoa Física",
        type: "PF",
        email: "pf@example.com",
        organizationId: ORG_ID,
      })
      .expect(200);

    const pfCategories = await selectClientCategories(ctx.db, pfClientId);
    assert.equal(pfCategories.length, 0);

    const bothClientId = "both-client-upsert";
    await agent
      .post("/api/client/upsert")
      .send({
        clientId: bothClientId,
        name: "Cliente Híbrido",
        type: "BOTH",
        email: "both@example.com",
        organizationId: ORG_ID,
      })
      .expect(200);

    const bothCategories = await selectClientCategories(ctx.db, bothClientId);
    assert.equal(bothCategories.length, BASE_CATEGORIES.length);

    const bothBaseIds = new Set(bothCategories.map(category => category.baseCategoryId));
    assert.deepEqual(bothBaseIds, new Set(BASE_CATEGORIES.map(category => category.id)));
  });
});
