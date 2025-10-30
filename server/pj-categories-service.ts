import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  isNull,
  like,
  ne,
  or,
} from "drizzle-orm";

import { getDb, type Database, type DatabaseTransaction } from "./db/client";
import { pjCategories, pjClientCategories } from "./db/schema";

type BaseCategoryRow = typeof pjCategories.$inferSelect;
type ClientCategoryRow = typeof pjClientCategories.$inferSelect;

type QueryExecutor = Database | DatabaseTransaction;

export interface CategoryTreeNode<TCategory> {
  category: TCategory;
  children: CategoryTreeNode<TCategory>[];
}

export type BaseCategoryScope = { type: "base" };
export type ClientCategoryScope = {
  type: "client";
  orgId: string;
  clientId: string;
};

export type CategoryScope = BaseCategoryScope | ClientCategoryScope;

export interface CreateBaseCategoryInput {
  id?: string;
  code: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
  sortOrder?: number | null;
  acceptsPostings?: boolean | null;
}

export interface CreateClientCategoryInput {
  id?: string;
  baseCategoryId?: string | null;
  name: string;
  description?: string | null;
  parentId?: string | null;
  sortOrder?: number | null;
  acceptsPostings?: boolean | null;
}

export interface MoveCategoryOptions {
  sortOrder?: number | null;
}

export class PjCategoriesService {
  constructor(private readonly db: Database = getDb()) {}

  async listBaseCategories(): Promise<BaseCategoryRow[]> {
    return this.db.query.pjCategories.findMany({
      orderBy: [
        asc(pjCategories.level),
        asc(pjCategories.sortOrder),
        asc(pjCategories.code),
      ],
    });
  }

  async listClientCategories(
    scope: ClientCategoryScope,
  ): Promise<ClientCategoryRow[]> {
    return this.db.query.pjClientCategories.findMany({
      where: and(
        eq(pjClientCategories.orgId, scope.orgId),
        eq(pjClientCategories.clientId, scope.clientId),
      ),
      orderBy: [
        asc(pjClientCategories.level),
        asc(pjClientCategories.sortOrder),
        asc(pjClientCategories.id),
      ],
    });
  }

  buildTree<TCategory extends { id: string; parentId: string | null; sortOrder: number | null; name: string }>(
    categories: TCategory[],
  ): CategoryTreeNode<TCategory>[] {
    const nodeById = new Map<string, CategoryTreeNode<TCategory>>();

    for (const category of categories) {
      nodeById.set(category.id, { category, children: [] });
    }

    const roots: CategoryTreeNode<TCategory>[] = [];

    for (const category of categories) {
      const node = nodeById.get(category.id)!;
      const parentId = category.parentId;

      if (!parentId || !nodeById.has(parentId)) {
        roots.push(node);
        continue;
      }

      nodeById.get(parentId)!.children.push(node);
    }

    const compareNodes = (a: CategoryTreeNode<TCategory>, b: CategoryTreeNode<TCategory>) => {
      const sortA = a.category.sortOrder ?? 0;
      const sortB = b.category.sortOrder ?? 0;
      if (sortA !== sortB) {
        return sortA - sortB;
      }
      return a.category.name.localeCompare(b.category.name);
    };

    const sortRecursively = (nodes: CategoryTreeNode<TCategory>[]) => {
      nodes.sort(compareNodes);
      for (const child of nodes) {
        sortRecursively(child.children);
      }
    };

    sortRecursively(roots);
    return roots;
  }

  async createCategory(
    scope: BaseCategoryScope,
    input: CreateBaseCategoryInput,
  ): Promise<BaseCategoryRow>;
  async createCategory(
    scope: ClientCategoryScope,
    input: CreateClientCategoryInput,
  ): Promise<ClientCategoryRow>;
  async createCategory(
    scope: CategoryScope,
    input: CreateBaseCategoryInput | CreateClientCategoryInput,
  ): Promise<BaseCategoryRow | ClientCategoryRow> {
    return this.db.transaction(async transaction => {
      if (scope.type === "base") {
        return this.createBaseCategory(transaction, input as CreateBaseCategoryInput);
      }

      return this.createClientCategory(transaction, scope, input as CreateClientCategoryInput);
    });
  }

  async moveCategory(
    scope: BaseCategoryScope,
    categoryId: string,
    newParentId: string | null,
    options?: MoveCategoryOptions,
  ): Promise<BaseCategoryRow>;
  async moveCategory(
    scope: ClientCategoryScope,
    categoryId: string,
    newParentId: string | null,
    options?: MoveCategoryOptions,
  ): Promise<ClientCategoryRow>;
  async moveCategory(
    scope: CategoryScope,
    categoryId: string,
    newParentId: string | null,
    options?: MoveCategoryOptions,
  ): Promise<BaseCategoryRow | ClientCategoryRow> {
    return this.db.transaction(async transaction => {
      if (scope.type === "base") {
        return this.moveBaseCategory(transaction, categoryId, newParentId, options);
      }

      return this.moveClientCategory(transaction, scope, categoryId, newParentId, options);
    });
  }

  async deleteCategory(scope: BaseCategoryScope, categoryId: string): Promise<void>;
  async deleteCategory(scope: ClientCategoryScope, categoryId: string): Promise<void>;
  async deleteCategory(scope: CategoryScope, categoryId: string): Promise<void> {
    await this.db.transaction(async transaction => {
      if (scope.type === "base") {
        await this.deleteBaseCategory(transaction, categoryId);
        return;
      }

      await this.deleteClientCategory(transaction, scope, categoryId);
    });
  }

  async updateAcceptsPostings(
    scope: BaseCategoryScope,
    categoryId: string,
    acceptsPostings: boolean,
  ): Promise<BaseCategoryRow>;
  async updateAcceptsPostings(
    scope: ClientCategoryScope,
    categoryId: string,
    acceptsPostings: boolean,
  ): Promise<ClientCategoryRow>;
  async updateAcceptsPostings(
    scope: CategoryScope,
    categoryId: string,
    acceptsPostings: boolean,
  ): Promise<BaseCategoryRow | ClientCategoryRow> {
    return this.db.transaction(async transaction => {
      if (scope.type === "base") {
        return this.updateBaseAcceptsPostings(transaction, categoryId, acceptsPostings);
      }

      return this.updateClientAcceptsPostings(transaction, scope, categoryId, acceptsPostings);
    });
  }

  async hasChildren(scope: BaseCategoryScope, categoryId: string): Promise<boolean>;
  async hasChildren(scope: ClientCategoryScope, categoryId: string): Promise<boolean>;
  async hasChildren(scope: CategoryScope, categoryId: string): Promise<boolean> {
    if (scope.type === "base") {
      return this.hasBaseChildren(this.db, categoryId);
    }

    return this.hasClientChildren(this.db, scope, categoryId);
  }

  private async createBaseCategory(
    transaction: DatabaseTransaction,
    input: CreateBaseCategoryInput,
  ): Promise<BaseCategoryRow> {
    const parentId = input.parentId ?? null;

    if (!input.name.trim()) {
      throw new Error("Nome da categoria não pode ser vazio");
    }

    if (!input.code.trim()) {
      throw new Error("Código da categoria não pode ser vazio");
    }

    const parent = parentId ? await this.getBaseCategory(transaction, parentId) : undefined;

    await this.assertBaseSiblingNameUnique(transaction, input.name, parentId);

    const id = input.id ?? randomUUID();
    const level = parent ? parent.level + 1 : 1;
    const segment = input.code.trim();
    const path = parent ? `${parent.path}.${segment}` : segment;

    const sortOrder = await this.resolveBaseSortOrder(transaction, parentId, input.sortOrder);

    const [created] = await transaction
      .insert(pjCategories)
      .values({
        id,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        parentId,
        isCore: false,
        acceptsPostings: input.acceptsPostings ?? true,
        level,
        path,
        sortOrder,
      })
      .returning();

    if (!created) {
      throw new Error("Falha ao criar categoria base");
    }

    return created;
  }

  private async createClientCategory(
    transaction: DatabaseTransaction,
    scope: ClientCategoryScope,
    input: CreateClientCategoryInput,
  ): Promise<ClientCategoryRow> {
    const parentId = input.parentId ?? null;

    if (!input.name.trim()) {
      throw new Error("Nome da categoria não pode ser vazio");
    }

    const parent = parentId
      ? await this.getClientCategory(transaction, scope, parentId)
      : undefined;

    await this.assertClientSiblingNameUnique(transaction, scope, input.name, parentId);

    const id = input.id ?? randomUUID();
    const level = parent ? parent.level + 1 : 0;
    const segment = id;
    const path = parent ? `${parent.path}.${segment}` : segment;

    const sortOrder = await this.resolveClientSortOrder(
      transaction,
      scope,
      parentId,
      input.sortOrder,
    );

    const [created] = await transaction
      .insert(pjClientCategories)
      .values({
        id,
        orgId: scope.orgId,
        clientId: scope.clientId,
        baseCategoryId: input.baseCategoryId ?? null,
        name: input.name,
        description: input.description ?? null,
        parentId,
        level,
        path,
        sortOrder,
        acceptsPostings: input.acceptsPostings ?? true,
      })
      .returning();

    if (!created) {
      throw new Error("Falha ao criar categoria do cliente");
    }

    return created;
  }

  private async moveBaseCategory(
    transaction: DatabaseTransaction,
    categoryId: string,
    newParentId: string | null,
    options?: MoveCategoryOptions,
  ): Promise<BaseCategoryRow> {
    const category = await this.getBaseCategory(transaction, categoryId);

    if (category.isCore) {
      throw new Error("Categorias base core não podem ser modificadas");
    }

    if (newParentId && newParentId === categoryId) {
      throw new Error("Categoria não pode ser pai de si mesma");
    }

    const parent = newParentId ? await this.getBaseCategory(transaction, newParentId) : undefined;

    if (parent && parent.path.startsWith(`${category.path}.`)) {
      throw new Error("Categoria não pode ser movida para um de seus descendentes");
    }

    await this.assertBaseSiblingNameUnique(transaction, category.name, newParentId, categoryId);

    const newLevel = parent ? parent.level + 1 : 1;
    const levelDelta = newLevel - category.level;
    const ownSegment = category.path.split(".").pop() ?? category.code;
    const newPath = parent ? `${parent.path}.${ownSegment}` : ownSegment;
    const newSortOrder =
      options?.sortOrder ?? category.sortOrder ?? (await this.resolveBaseSortOrder(transaction, newParentId, null));

    await this.updateBaseSubtree(
      transaction,
      category,
      newParentId,
      newPath,
      levelDelta,
      newSortOrder,
    );

    return this.getBaseCategory(transaction, categoryId);
  }

  private async moveClientCategory(
    transaction: DatabaseTransaction,
    scope: ClientCategoryScope,
    categoryId: string,
    newParentId: string | null,
    options?: MoveCategoryOptions,
  ): Promise<ClientCategoryRow> {
    const category = await this.getClientCategory(transaction, scope, categoryId);

    if (newParentId && newParentId === categoryId) {
      throw new Error("Categoria não pode ser pai de si mesma");
    }

    const parent = newParentId
      ? await this.getClientCategory(transaction, scope, newParentId)
      : undefined;

    if (parent && parent.path.startsWith(`${category.path}.`)) {
      throw new Error("Categoria não pode ser movida para um de seus descendentes");
    }

    await this.assertClientSiblingNameUnique(
      transaction,
      scope,
      category.name,
      newParentId,
      categoryId,
    );

    const newLevel = parent ? parent.level + 1 : 0;
    const levelDelta = newLevel - category.level;
    const ownSegment = category.path.split(".").pop() ?? category.id;
    const newPath = parent ? `${parent.path}.${ownSegment}` : ownSegment;
    const newSortOrder =
      options?.sortOrder ?? category.sortOrder ?? (await this.resolveClientSortOrder(transaction, scope, newParentId, null));

    await this.updateClientSubtree(
      transaction,
      scope,
      category,
      newParentId,
      newPath,
      levelDelta,
      newSortOrder,
    );

    return this.getClientCategory(transaction, scope, categoryId);
  }

  private async deleteBaseCategory(
    transaction: DatabaseTransaction,
    categoryId: string,
  ): Promise<void> {
    const category = await this.getBaseCategory(transaction, categoryId);

    if (category.isCore) {
      throw new Error("Categorias base core não podem ser modificadas");
    }

    const hasChildren = await this.hasBaseChildren(transaction, categoryId);
    if (hasChildren) {
      throw new Error("Não é possível excluir categoria com filhos");
    }

    await transaction.delete(pjCategories).where(eq(pjCategories.id, categoryId));
  }

  private async deleteClientCategory(
    transaction: DatabaseTransaction,
    scope: ClientCategoryScope,
    categoryId: string,
  ): Promise<void> {
    const hasChildren = await this.hasClientChildren(transaction, scope, categoryId);
    if (hasChildren) {
      throw new Error("Não é possível excluir categoria com filhos");
    }

    await transaction
      .delete(pjClientCategories)
      .where(
        and(
          eq(pjClientCategories.orgId, scope.orgId),
          eq(pjClientCategories.clientId, scope.clientId),
          eq(pjClientCategories.id, categoryId),
        ),
      );
  }

  private async updateBaseAcceptsPostings(
    transaction: DatabaseTransaction,
    categoryId: string,
    acceptsPostings: boolean,
  ): Promise<BaseCategoryRow> {
    const category = await this.getBaseCategory(transaction, categoryId);

    if (category.isCore) {
      throw new Error("Categorias base core não podem ser modificadas");
    }

    const [updated] = await transaction
      .update(pjCategories)
      .set({ acceptsPostings })
      .where(eq(pjCategories.id, categoryId))
      .returning();

    if (!updated) {
      throw new Error("Falha ao atualizar categoria base");
    }

    return updated;
  }

  private async updateClientAcceptsPostings(
    transaction: DatabaseTransaction,
    scope: ClientCategoryScope,
    categoryId: string,
    acceptsPostings: boolean,
  ): Promise<ClientCategoryRow> {
    const [updated] = await transaction
      .update(pjClientCategories)
      .set({ acceptsPostings })
      .where(
        and(
          eq(pjClientCategories.orgId, scope.orgId),
          eq(pjClientCategories.clientId, scope.clientId),
          eq(pjClientCategories.id, categoryId),
        ),
      )
      .returning();

    if (!updated) {
      throw new Error("Falha ao atualizar categoria do cliente");
    }

    return updated;
  }

  private async getBaseCategory(
    executor: QueryExecutor,
    categoryId: string,
  ): Promise<BaseCategoryRow> {
    const category = await executor.query.pjCategories.findFirst({
      where: eq(pjCategories.id, categoryId),
    });

    if (!category) {
      throw new Error(`Categoria base ${categoryId} não encontrada`);
    }

    return category;
  }

  private async getClientCategory(
    executor: QueryExecutor,
    scope: ClientCategoryScope,
    categoryId: string,
  ): Promise<ClientCategoryRow> {
    const category = await executor.query.pjClientCategories.findFirst({
      where: and(
        eq(pjClientCategories.orgId, scope.orgId),
        eq(pjClientCategories.clientId, scope.clientId),
        eq(pjClientCategories.id, categoryId),
      ),
    });

    if (!category) {
      throw new Error(`Categoria do cliente ${categoryId} não encontrada`);
    }

    return category;
  }

  private async assertBaseSiblingNameUnique(
    transaction: DatabaseTransaction,
    name: string,
    parentId: string | null,
    excludeId?: string,
  ): Promise<void> {
    const conditions = [eq(pjCategories.name, name)];

    if (parentId) {
      conditions.push(eq(pjCategories.parentId, parentId));
    } else {
      conditions.push(isNull(pjCategories.parentId));
    }

    if (excludeId) {
      conditions.push(ne(pjCategories.id, excludeId));
    }

    const existing = await transaction.query.pjCategories.findFirst({
      where: and(...conditions),
      columns: { id: pjCategories.id },
    });

    if (existing) {
      throw new Error("Já existe uma categoria com este nome no mesmo nível");
    }
  }

  private async assertClientSiblingNameUnique(
    transaction: DatabaseTransaction,
    scope: ClientCategoryScope,
    name: string,
    parentId: string | null,
    excludeId?: string,
  ): Promise<void> {
    const conditions = [
      eq(pjClientCategories.orgId, scope.orgId),
      eq(pjClientCategories.clientId, scope.clientId),
      eq(pjClientCategories.name, name),
    ];

    if (parentId) {
      conditions.push(eq(pjClientCategories.parentId, parentId));
    } else {
      conditions.push(isNull(pjClientCategories.parentId));
    }

    if (excludeId) {
      conditions.push(ne(pjClientCategories.id, excludeId));
    }

    const existing = await transaction.query.pjClientCategories.findFirst({
      where: and(...conditions),
      columns: { id: pjClientCategories.id },
    });

    if (existing) {
      throw new Error("Já existe uma categoria com este nome no mesmo nível");
    }
  }

  private async resolveBaseSortOrder(
    transaction: DatabaseTransaction,
    parentId: string | null,
    explicit: number | null | undefined,
  ): Promise<number> {
    if (typeof explicit === "number") {
      return explicit;
    }

    const lastSibling = await transaction.query.pjCategories.findFirst({
      where: parentId
        ? eq(pjCategories.parentId, parentId)
        : isNull(pjCategories.parentId),
      orderBy: [desc(pjCategories.sortOrder)],
      columns: { sortOrder: pjCategories.sortOrder },
    });

    return (lastSibling?.sortOrder ?? 0) + 10;
  }

  private async resolveClientSortOrder(
    transaction: DatabaseTransaction,
    scope: ClientCategoryScope,
    parentId: string | null,
    explicit: number | null | undefined,
  ): Promise<number> {
    if (typeof explicit === "number") {
      return explicit;
    }

    const conditions = [
      eq(pjClientCategories.orgId, scope.orgId),
      eq(pjClientCategories.clientId, scope.clientId),
    ];

    if (parentId) {
      conditions.push(eq(pjClientCategories.parentId, parentId));
    } else {
      conditions.push(isNull(pjClientCategories.parentId));
    }

    const lastSibling = await transaction.query.pjClientCategories.findFirst({
      where: and(...conditions),
      orderBy: [desc(pjClientCategories.sortOrder)],
      columns: { sortOrder: pjClientCategories.sortOrder },
    });

    return (lastSibling?.sortOrder ?? 0) + 10;
  }

  private async hasBaseChildren(
    executor: QueryExecutor,
    categoryId: string,
  ): Promise<boolean> {
    const child = await executor.query.pjCategories.findFirst({
      columns: { id: pjCategories.id },
      where: eq(pjCategories.parentId, categoryId),
    });
    return Boolean(child);
  }

  private async hasClientChildren(
    executor: QueryExecutor,
    scope: ClientCategoryScope,
    categoryId: string,
  ): Promise<boolean> {
    const child = await executor.query.pjClientCategories.findFirst({
      columns: { id: pjClientCategories.id },
      where: and(
        eq(pjClientCategories.orgId, scope.orgId),
        eq(pjClientCategories.clientId, scope.clientId),
        eq(pjClientCategories.parentId, categoryId),
      ),
    });
    return Boolean(child);
  }

  private async updateBaseSubtree(
    transaction: DatabaseTransaction,
    category: BaseCategoryRow,
    newParentId: string | null,
    newPath: string,
    levelDelta: number,
    newSortOrder: number,
  ): Promise<void> {
    const scopePrefix = `${category.path}.`;

    const descendants = await transaction.query.pjCategories.findMany({
      where: or(
        eq(pjCategories.id, category.id),
        like(pjCategories.path, `${scopePrefix}%`),
      ),
      orderBy: [asc(pjCategories.level)],
    });

    for (const descendant of descendants) {
      const isRoot = descendant.id === category.id;
      const suffix = descendant.path.startsWith(scopePrefix)
        ? descendant.path.slice(scopePrefix.length)
        : "";
      const nextPath = suffix ? `${newPath}.${suffix}` : newPath;
      const nextLevel = descendant.level + levelDelta;

      const update: Partial<BaseCategoryRow> & { parentId?: string | null; path: string; level: number; sortOrder?: number } = {
        path: nextPath,
        level: nextLevel,
      };

      if (isRoot) {
        update.parentId = newParentId;
        update.sortOrder = newSortOrder;
      }

      await transaction
        .update(pjCategories)
        .set(update)
        .where(eq(pjCategories.id, descendant.id));
    }
  }

  private async updateClientSubtree(
    transaction: DatabaseTransaction,
    scope: ClientCategoryScope,
    category: ClientCategoryRow,
    newParentId: string | null,
    newPath: string,
    levelDelta: number,
    newSortOrder: number,
  ): Promise<void> {
    const scopePrefix = `${category.path}.`;

    const descendants = await transaction.query.pjClientCategories.findMany({
      where: and(
        eq(pjClientCategories.orgId, scope.orgId),
        eq(pjClientCategories.clientId, scope.clientId),
        or(
          eq(pjClientCategories.id, category.id),
          like(pjClientCategories.path, `${scopePrefix}%`),
        ),
      ),
      orderBy: [asc(pjClientCategories.level)],
    });

    for (const descendant of descendants) {
      const isRoot = descendant.id === category.id;
      const suffix = descendant.path.startsWith(scopePrefix)
        ? descendant.path.slice(scopePrefix.length)
        : "";
      const nextPath = suffix ? `${newPath}.${suffix}` : newPath;
      const nextLevel = descendant.level + levelDelta;

      const update: Partial<ClientCategoryRow> & {
        parentId?: string | null;
        path: string;
        level: number;
        sortOrder?: number;
      } = {
        path: nextPath,
        level: nextLevel,
      };

      if (isRoot) {
        update.parentId = newParentId;
        update.sortOrder = newSortOrder;
      }

      await transaction
        .update(pjClientCategories)
        .set(update)
        .where(eq(pjClientCategories.id, descendant.id));
    }
  }
}

