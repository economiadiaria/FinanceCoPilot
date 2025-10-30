import { describe, before, after, beforeEach, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import bcrypt from "bcrypt";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import fs from "node:fs/promises";
import path from "node:path";

import { registerRoutes } from "../server/routes";
import { MemStorage, setStorageProvider, type IStorage } from "../server/storage";
import type { Database } from "../server/db/client";
import { pjCategories } from "../server/db/schema";
import type { PjCategory, User } from "@shared/schema";

const ORG_ID = "org-pj-global";
const MASTER_USER_ID = "user-master-global";
const MASTER_EMAIL = "master.global@example.com";
const MASTER_PASSWORD = "master-global-secret";

const MIGRATION_PATH = path.resolve(process.cwd(), "migrations/0002_pj_categories.sql");

interface TestContext {
  storage: IStorage;
  pg: PGlite;
  db: Database;
  appServer?: import("http").Server;
  seedCategories: PjCategory[];
}

async function seedMasterUser(storage: IStorage) {
  const masterUser: User = {
    userId: MASTER_USER_ID,
    email: MASTER_EMAIL,
    passwordHash: await bcrypt.hash(MASTER_PASSWORD, 10),
    role: "master",
    name: "Master Global",
    organizationId: ORG_ID,
    clientIds: [],
    managedConsultantIds: [],
    managedClientIds: [],
  };

  await storage.createUser(masterUser);
}

async function login(agent: request.SuperAgentTest) {
  await agent.post("/api/auth/login").send({ email: MASTER_EMAIL, password: MASTER_PASSWORD }).expect(200);
}

async function runMigration(pg: PGlite, migrationPath: string) {
  await pg.exec(`
    CREATE OR REPLACE FUNCTION gen_random_uuid()
    RETURNS uuid AS $$
    SELECT (
      lpad(to_hex(floor(random() * 4294967295)::bigint), 8, '0') || '-' ||
      lpad(to_hex(floor(random() * 65535)::bigint), 4, '0') || '-4' ||
      lpad(to_hex(floor(random() * 4095)::bigint), 3, '0') || '-' ||
      substr('89ab', floor(random() * 4)::int + 1, 1) ||
      lpad(to_hex(floor(random() * 4095)::bigint), 3, '0') || '-' ||
      lpad(to_hex(floor(random() * 281474976710655)::bigint), 12, '0')
    )::uuid;
    $$ LANGUAGE SQL IMMUTABLE;
  `);

  const sql = await fs.readFile(migrationPath, "utf8");
  const statements = sql.split("--> statement-breakpoint");

  for (const statement of statements) {
    const trimmed = statement.trim();
    if (!trimmed) {
      continue;
    }

    await pg.exec(trimmed);
  }
}

const ctx: TestContext = {
  storage: new MemStorage(),
  pg: null as unknown as PGlite,
  db: null as unknown as Database,
  seedCategories: [],
};

before(async () => {
  ctx.pg = new PGlite();
  await runMigration(ctx.pg, MIGRATION_PATH);
  ctx.db = drizzle(ctx.pg, { schema: { pjCategories } }) as unknown as Database;
  ctx.seedCategories = await ctx.db.select().from(pjCategories);

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(
    session({
      secret: "pj-categories-global", 
      resave: false,
      saveUninitialized: false,
    }),
  );

  ctx.storage = setStorageProvider(new MemStorage());
  ctx.appServer = await registerRoutes(app, { db: ctx.db });
});

after(async () => {
  if (ctx.appServer?.listening) {
    await new Promise<void>((resolve, reject) => {
      ctx.appServer!.close(err => (err ? reject(err) : resolve()));
    });
  }

  if (ctx.pg) {
    await ctx.pg.close();
  }
});

beforeEach(async () => {
  ctx.storage = setStorageProvider(new MemStorage());
  await ctx.storage.setPjCategories(ctx.seedCategories.map(category => ({ ...category })));
  await seedMasterUser(ctx.storage);
});

describe("PJ global categories", () => {
  it("loads pj_categories migration seeds into storage", async () => {
    const coreSeeds = ctx.seedCategories.filter(category => category.isCore && category.acceptsPostings === false);
    assert.equal(coreSeeds.length, 6);

    const storageCategories = await ctx.storage.getPjCategories();
    const storageCore = storageCategories.filter(category => category.isCore && category.acceptsPostings === false);
    assert.equal(storageCore.length, 6);

    assert.deepEqual(
      storageCore.map(category => category.code).sort(),
      coreSeeds.map(category => category.code).sort(),
    );
  });

  it("allows updating/deleting non-core categories while blocking core seeds", async () => {
    const agent = request.agent(ctx.appServer!);
    await login(agent);

    const categories = await ctx.storage.getPjCategories();
    const parent = categories.find(category => category.code === "RECEITA");
    assert.ok(parent, "expected seed category RECEITA");

    const now = new Date().toISOString();
    const customCategory: PjCategory = {
      id: "custom-category-id",
      code: "RECEITA_SERVICOS_CUSTOM",
      name: "Receita de Serviços Custom",
      description: "Serviços personalizados",
      parentId: parent!.id,
      isCore: false,
      acceptsPostings: true,
      level: parent!.level + 1,
      path: `${parent!.path}.RECEITA_SERVICOS_CUSTOM`,
      sortOrder: parent!.sortOrder + 1,
      createdAt: now,
      updatedAt: now,
    };

    await ctx.storage.setPjCategories([...categories, customCategory]);

    const baselineLogs = await ctx.storage.getAuditLogs(ORG_ID);

    const patchResponse = await agent
      .patch(`/api/pj/global-categories/${customCategory.id}`)
      .send({ name: "Receita de Serviços Custom Premium", acceptsPostings: false })
      .expect(200);

    assert.equal(patchResponse.body.category.name, "Receita de Serviços Custom Premium");
    assert.equal(patchResponse.body.category.acceptsPostings, false);

    const logsAfterPatch = await ctx.storage.getAuditLogs(ORG_ID);
    assert.equal(logsAfterPatch.length > baselineLogs.length, true);
    const updateAudit = logsAfterPatch.find(
      event => event.eventType === "pj.plan.global.update" && event.targetId === customCategory.id,
    );
    assert.ok(updateAudit, "expected audit event for global category update");

    const coreUpdate = await agent
      .patch(`/api/pj/global-categories/${parent!.id}`)
      .send({ name: "Nova Receita" })
      .expect(403);
    assert.equal(coreUpdate.body.error, "Categorias núcleo não podem ser alteradas");
    const logsAfterCoreUpdate = await ctx.storage.getAuditLogs(ORG_ID);
    assert.equal(logsAfterCoreUpdate.length, logsAfterPatch.length);

    await agent.delete(`/api/pj/global-categories/${customCategory.id}`).expect(204);
    const logsAfterDelete = await ctx.storage.getAuditLogs(ORG_ID);
    assert.equal(logsAfterDelete.length > logsAfterPatch.length, true);
    const deleteAudit = logsAfterDelete.find(
      event => event.eventType === "pj.plan.global.delete" && event.targetId === customCategory.id,
    );
    assert.ok(deleteAudit, "expected audit event for global category delete");

    const remaining = await ctx.storage.getPjCategories();
    assert.equal(remaining.some(category => category.id === customCategory.id), false);

    const coreDelete = await agent.delete(`/api/pj/global-categories/${parent!.id}`).expect(403);
    assert.equal(coreDelete.body.error, "Categorias núcleo não podem ser removidas");
    const logsAfterCoreDelete = await ctx.storage.getAuditLogs(ORG_ID);
    assert.equal(logsAfterCoreDelete.length, logsAfterDelete.length);
  });
});
