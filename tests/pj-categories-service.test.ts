import { describe, before, after, beforeEach, it } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";

import { pjCategories, pjClientCategories } from "../server/db/schema";
import type { Database } from "../server/db/client";
import {
  PjCategoriesService,
  type BaseCategoryScope,
  type ClientCategoryScope,
} from "../server/pj-categories-service";

interface TestContext {
  pg: PGlite;
  db: Database;
  service: PjCategoriesService;
}

const BASE_SCOPE: BaseCategoryScope = { type: "base" };
const CLIENT_SCOPE: ClientCategoryScope = {
  type: "client",
  orgId: "org-test",
  clientId: "client-test",
};

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
}

describe("PjCategoriesService", () => {
  const ctx: TestContext = {
    pg: null as unknown as PGlite,
    db: null as unknown as Database,
    service: null as unknown as PjCategoriesService,
  };

  before(async () => {
    ctx.pg = new PGlite();
    await ensureTestTables(ctx.pg);
    ctx.db = drizzle(ctx.pg, { schema: { pjCategories, pjClientCategories } }) as unknown as Database;
    ctx.service = new PjCategoriesService(ctx.db);
  });

  after(async () => {
    await ctx.pg.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.db);
  });

  it("lists base categories and builds tree", async () => {
    await ctx.db.insert(pjCategories).values([
      {
        id: "root-b",
        code: "ROOT_B",
        name: "Root B",
        description: null,
        parentId: null,
        isCore: false,
        acceptsPostings: false,
        level: 1,
        path: "ROOT_B",
        sortOrder: 10,
      },
      {
        id: "root-a",
        code: "ROOT_A",
        name: "Root A",
        description: null,
        parentId: null,
        isCore: false,
        acceptsPostings: false,
        level: 1,
        path: "ROOT_A",
        sortOrder: 20,
      },
      {
        id: "child-a",
        code: "CHILD_A",
        name: "Child A",
        description: null,
        parentId: "root-a",
        isCore: false,
        acceptsPostings: true,
        level: 2,
        path: "ROOT_A.CHILD_A",
        sortOrder: 5,
      },
    ]);

    const categories = await ctx.service.listBaseCategories();
    assert.equal(categories[0]?.code, "ROOT_B");
    assert.equal(categories[1]?.code, "ROOT_A");
    assert.equal(categories[2]?.code, "CHILD_A");

    const tree = ctx.service.buildTree(categories);
    assert.equal(tree.length, 2);
    assert.equal(tree[0]?.category.code, "ROOT_B");
    assert.equal(tree[1]?.category.code, "ROOT_A");
    assert.equal(tree[1]?.children.length, 1);
    assert.equal(tree[1]?.children[0]?.category.code, "CHILD_A");
  });

  it("creates base categories computing path and level", async () => {
    await ctx.db.insert(pjCategories).values({
      id: "base-root",
      code: "ROOT",
      name: "Root",
      description: null,
      parentId: null,
      isCore: false,
      acceptsPostings: false,
      level: 1,
      path: "ROOT",
      sortOrder: 10,
    });

    const created = await ctx.service.createCategory(BASE_SCOPE, {
      id: "child",
      code: "CHILD",
      name: "Child",
      parentId: "base-root",
    });

    assert.equal(created.parentId, "base-root");
    assert.equal(created.level, 2);
    assert.equal(created.path, "ROOT.CHILD");
    assert.equal(created.sortOrder, 10);
  });

  it("prevents duplicate names among base siblings", async () => {
    await ctx.db.insert(pjCategories).values([
      {
        id: "base-root",
        code: "ROOT",
        name: "Root",
        description: null,
        parentId: null,
        isCore: false,
        acceptsPostings: false,
        level: 1,
        path: "ROOT",
        sortOrder: 10,
      },
      {
        id: "child-a",
        code: "CHILD_A",
        name: "Child",
        description: null,
        parentId: "base-root",
        isCore: false,
        acceptsPostings: true,
        level: 2,
        path: "ROOT.CHILD_A",
        sortOrder: 10,
      },
    ]);

    await assert.rejects(
      () =>
        ctx.service.createCategory(BASE_SCOPE, {
          code: "CHILD_B",
          name: "Child",
          parentId: "base-root",
        }),
      /Já existe uma categoria com este nome no mesmo nível/,
    );
  });

  it("creates client categories with deterministic paths", async () => {
    const root = await ctx.service.createCategory(CLIENT_SCOPE, {
      id: "client-root",
      name: "Root",
    });

    assert.equal(root.level, 0);
    assert.equal(root.path, "client-root");

    const child = await ctx.service.createCategory(CLIENT_SCOPE, {
      id: "client-child",
      name: "Child",
      parentId: root.id,
    });

    assert.equal(child.parentId, root.id);
    assert.equal(child.level, 1);
    assert.equal(child.path, `${root.path}.client-child`);
  });

  it("moves base categories recalculating subtree", async () => {
    await ctx.db.insert(pjCategories).values([
      {
        id: "root-one",
        code: "ROOT_ONE",
        name: "Root One",
        description: null,
        parentId: null,
        isCore: false,
        acceptsPostings: false,
        level: 1,
        path: "ROOT_ONE",
        sortOrder: 10,
      },
      {
        id: "root-two",
        code: "ROOT_TWO",
        name: "Root Two",
        description: null,
        parentId: null,
        isCore: false,
        acceptsPostings: false,
        level: 1,
        path: "ROOT_TWO",
        sortOrder: 20,
      },
      {
        id: "child",
        code: "CHILD",
        name: "Child",
        description: null,
        parentId: "root-one",
        isCore: false,
        acceptsPostings: true,
        level: 2,
        path: "ROOT_ONE.CHILD",
        sortOrder: 15,
      },
      {
        id: "grand",
        code: "GRAND",
        name: "Grand",
        description: null,
        parentId: "child",
        isCore: false,
        acceptsPostings: true,
        level: 3,
        path: "ROOT_ONE.CHILD.GRAND",
        sortOrder: 5,
      },
    ]);

    await ctx.service.moveCategory(BASE_SCOPE, "child", "root-two", { sortOrder: 55 });

    const moved = await ctx.db.query.pjCategories.findFirst({
      where: eq(pjCategories.id, "child"),
    });
    const grand = await ctx.db.query.pjCategories.findFirst({
      where: eq(pjCategories.id, "grand"),
    });

    assert.equal(moved?.parentId, "root-two");
    assert.equal(moved?.path, "ROOT_TWO.CHILD");
    assert.equal(moved?.level, 2);
    assert.equal(moved?.sortOrder, 55);
    assert.equal(grand?.path, "ROOT_TWO.CHILD.GRAND");
    assert.equal(grand?.level, 3);
  });

  it("prevents cycles when moving base categories", async () => {
    await ctx.db.insert(pjCategories).values([
      {
        id: "root",
        code: "ROOT",
        name: "Root",
        description: null,
        parentId: null,
        isCore: false,
        acceptsPostings: false,
        level: 1,
        path: "ROOT",
        sortOrder: 10,
      },
      {
        id: "child",
        code: "CHILD",
        name: "Child",
        description: null,
        parentId: "root",
        isCore: false,
        acceptsPostings: true,
        level: 2,
        path: "ROOT.CHILD",
        sortOrder: 10,
      },
    ]);

    await assert.rejects(
      () => ctx.service.moveCategory(BASE_SCOPE, "root", "child"),
      /descendentes/,
    );
  });

  it("moves client categories updating subtree", async () => {
    const rootOne = await ctx.service.createCategory(CLIENT_SCOPE, {
      id: "client-root-one",
      name: "Root One",
    });
    const rootTwo = await ctx.service.createCategory(CLIENT_SCOPE, {
      id: "client-root-two",
      name: "Root Two",
    });
    const child = await ctx.service.createCategory(CLIENT_SCOPE, {
      id: "client-child",
      name: "Child",
      parentId: rootOne.id,
    });
    await ctx.service.createCategory(CLIENT_SCOPE, {
      id: "client-grand",
      name: "Grand",
      parentId: child.id,
    });

    await ctx.service.moveCategory(CLIENT_SCOPE, child.id, rootTwo.id, { sortOrder: 70 });

    const moved = await ctx.db.query.pjClientCategories.findFirst({
      where: eq(pjClientCategories.id, child.id),
    });
    const grand = await ctx.db.query.pjClientCategories.findFirst({
      where: eq(pjClientCategories.id, "client-grand"),
    });

    assert.equal(moved?.parentId, rootTwo.id);
    assert.ok(moved?.path.startsWith(`${rootTwo.path}.`));
    assert.equal(grand?.path.startsWith(`${rootTwo.path}.`), true);
    assert.equal(grand?.level, 2);
  });

  it("refuses to delete categories with children", async () => {
    await ctx.db.insert(pjCategories).values([
      {
        id: "root",
        code: "ROOT",
        name: "Root",
        description: null,
        parentId: null,
        isCore: false,
        acceptsPostings: false,
        level: 1,
        path: "ROOT",
        sortOrder: 10,
      },
      {
        id: "child",
        code: "CHILD",
        name: "Child",
        description: null,
        parentId: "root",
        isCore: false,
        acceptsPostings: true,
        level: 2,
        path: "ROOT.CHILD",
        sortOrder: 10,
      },
    ]);

    await assert.rejects(
      () => ctx.service.deleteCategory(BASE_SCOPE, "root"),
      /filhos/,
    );
  });

  it("deletes client leaf categories", async () => {
    const root = await ctx.service.createCategory(CLIENT_SCOPE, {
      id: "client-root",
      name: "Root",
    });
    const child = await ctx.service.createCategory(CLIENT_SCOPE, {
      id: "client-child",
      name: "Child",
      parentId: root.id,
    });

    await ctx.service.deleteCategory(CLIENT_SCOPE, child.id);

    const deleted = await ctx.db.query.pjClientCategories.findFirst({
      where: eq(pjClientCategories.id, child.id),
    });
    assert.equal(deleted, undefined);
  });

  it("updates accepts postings for both scopes", async () => {
    const base = await ctx.service.createCategory(BASE_SCOPE, {
      id: "base-updatable",
      code: "UPD",
      name: "Updatable",
    });
    const updatedBase = await ctx.service.updateAcceptsPostings(BASE_SCOPE, base.id, false);
    assert.equal(updatedBase.acceptsPostings, false);

    const client = await ctx.service.createCategory(CLIENT_SCOPE, {
      id: "client-updatable",
      name: "Updatable",
    });
    const updatedClient = await ctx.service.updateAcceptsPostings(
      CLIENT_SCOPE,
      client.id,
      false,
    );
    assert.equal(updatedClient.acceptsPostings, false);
  });

  it("detects children presence", async () => {
    const root = await ctx.service.createCategory(CLIENT_SCOPE, {
      id: "parent",
      name: "Parent",
    });
    await ctx.service.createCategory(CLIENT_SCOPE, {
      id: "child",
      name: "Child",
      parentId: root.id,
    });

    assert.equal(await ctx.service.hasChildren(CLIENT_SCOPE, root.id), true);
    assert.equal(await ctx.service.hasChildren(CLIENT_SCOPE, "child"), false);
  });

  it("blocks mutations on core base categories", async () => {
    await ctx.db.insert(pjCategories).values({
      id: "core",
      code: "CORE",
      name: "Core",
      description: null,
      parentId: null,
      isCore: true,
      acceptsPostings: false,
      level: 1,
      path: "CORE",
      sortOrder: 10,
    });

    await assert.rejects(
      () => ctx.service.moveCategory(BASE_SCOPE, "core", null),
      /core não podem ser modificadas/,
    );
    await assert.rejects(
      () => ctx.service.deleteCategory(BASE_SCOPE, "core"),
      /core não podem ser modificadas/,
    );
    await assert.rejects(
      () => ctx.service.updateAcceptsPostings(BASE_SCOPE, "core", true),
      /core não podem ser modificadas/,
    );
  });
});

