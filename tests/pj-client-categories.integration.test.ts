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
import { MemStorage, setStorageProvider, type IStorage } from "../server/storage";
import { setDbProvider, type Database } from "../server/db/client";
import { pjCategories, pjClientCategories } from "../server/db/schema";
import { onboardPjClientCategories } from "../server/pj-client-category-onboarding";
import type { User } from "@shared/schema";

const ORG_ID = "org-pj-onboarding";
const MASTER_USER_ID = "user-master-onboarding";
const MASTER_EMAIL = "master.onboarding@example.com";
const MASTER_PASSWORD = "master-onboarding-secret";

const BASE_ROOT_ID = "base-root";
const BASE_CHILD_ID = "base-child";

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

async function resetDatabase(db: Database) {
  await db.delete(pjClientCategories);
  await db.delete(pjCategories);

  await db.insert(pjCategories).values([
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
  ]);
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
    })
    .from(pjClientCategories)
    .where(eq(pjClientCategories.clientId, clientId))
    .orderBy(
      asc(pjClientCategories.level),
      asc(pjClientCategories.sortOrder),
      asc(pjClientCategories.id),
    );
}

describe("PJ client category onboarding", () => {
const ctx: TestContext = {
  storage: new MemStorage(),
  pg: null as unknown as PGlite,
  db: null as unknown as Database,
};

  before(async () => {
    ctx.pg = new PGlite();
    await ensureTestTables(ctx.pg);
    ctx.db = drizzle(ctx.pg, { schema: { pjCategories, pjClientCategories } }) as unknown as Database;
    setDbProvider(ctx.db);

    ctx.storage = new MemStorage();
    setStorageProvider(ctx.storage);
    await seedStorage(ctx.storage);
    await resetDatabase(ctx.db);

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

    ctx.appServer = await registerRoutes(app);
  });

  after(async () => {
    if (ctx.appServer?.listening) {
      await new Promise<void>((resolve, reject) => {
        ctx.appServer!.close(err => (err ? reject(err) : resolve()));
      });
    }
    setDbProvider(undefined);
    await ctx.pg.close();
  });

  beforeEach(async () => {
    ctx.storage = new MemStorage();
    setStorageProvider(ctx.storage);
    await seedStorage(ctx.storage);
    await resetDatabase(ctx.db);
    setDbProvider(ctx.db);
  });

  it("clones base categories when creating a new PJ client", async () => {
    const agent = request.agent(ctx.appServer!);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_EMAIL, password: MASTER_PASSWORD })
      .expect(200);

    const clientId = "pj-client-onboarding";
    const response = await agent
      .post("/api/client/upsert")
      .send({
        clientId,
        name: "Empresa Onboarding",
        type: "PJ",
        email: "empresa@onboarding.example.com",
        organizationId: ORG_ID,
      })
      .expect(200);

    assert.equal(response.body.clientId, clientId);

    const inserted = await selectClientCategories(ctx.db, clientId);
    assert.equal(inserted.length, 2);

    const root = inserted.find(category => category.parentId === null);
    const child = inserted.find(category => category.parentId === root?.id);

    assert.ok(root, "root category should exist");
    assert.ok(child, "child category should exist");
    assert.equal(root!.level, 0);
    assert.equal(child!.level, 1);
    assert.equal(child!.path, `${root!.id}.${child!.id}`);

    const stored = await ctx.storage.getPjClientCategories(ORG_ID, clientId);
    assert.deepEqual(stored, inserted);
  });

  it("is idempotent when categories already exist for a new client", async () => {
    const clientId = "pj-client-idempotent";

    await ctx.db.transaction(async transaction => {
      await onboardPjClientCategories({
        orgId: ORG_ID,
        clientId,
        storage: ctx.storage,
        transaction,
      });
    });

    ctx.storage = new MemStorage();
    setStorageProvider(ctx.storage);
    await seedStorage(ctx.storage);
    setDbProvider(ctx.db);

    const agent = request.agent(ctx.appServer!);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_EMAIL, password: MASTER_PASSWORD })
      .expect(200);

    await agent
      .post("/api/client/upsert")
      .send({
        clientId,
        name: "Empresa Idempotente",
        type: "PJ",
        email: "idempotente@onboarding.example.com",
        organizationId: ORG_ID,
      })
      .expect(200);

    const categories = await selectClientCategories(ctx.db, clientId);
    assert.equal(categories.length, 2);

    const duplicates = new Set(categories.map(category => category.baseCategoryId));
    assert.equal(duplicates.size, categories.length, "base categories should not be duplicated");

    const stored = await ctx.storage.getPjClientCategories(ORG_ID, clientId);
    assert.deepEqual(stored, categories);
  });

  it("skips onboarding for non-PJ clients", async () => {
    const agent = request.agent(ctx.appServer!);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_EMAIL, password: MASTER_PASSWORD })
      .expect(200);

    const clientId = "pf-client";
    await agent
      .post("/api/client/upsert")
      .send({
        clientId,
        name: "Pessoa Física",
        type: "PF",
        email: "pf@example.com",
        organizationId: ORG_ID,
      })
      .expect(200);

    const categories = await selectClientCategories(ctx.db, clientId);
    assert.equal(categories.length, 0);

    const stored = await ctx.storage.getPjClientCategories(ORG_ID, clientId);
    assert.equal(stored.length, 0);
  });
});
