import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";

import { pjCategories, pjClientCategories } from "./db/schema";
import type { DatabaseTransaction } from "./db/client";
import type { RequestLogger } from "./observability/logger";
import type { IStorage, PjClientCategoryRecord } from "./storage";

interface OnboardParams {
  orgId: string;
  clientId: string;
  storage: IStorage;
  transaction: DatabaseTransaction;
  logger?: RequestLogger;
}

interface OnboardResult {
  created: boolean;
  categories: PjClientCategoryRecord[];
}

function normalizeClientCategory(
  category: typeof pjClientCategories.$inferSelect,
): PjClientCategoryRecord {
  if (!category.baseCategoryId) {
    throw new Error(`Categoria PJ do cliente ${category.id} sem vínculo com base`);
  }

  return {
    id: category.id,
    orgId: category.orgId,
    clientId: category.clientId,
    baseCategoryId: category.baseCategoryId,
    parentId: category.parentId ?? null,
    level: category.level,
    path: category.path,
    sortOrder: category.sortOrder,
  };
}

export async function onboardPjClientCategories({
  orgId,
  clientId,
  storage,
  transaction,
  logger,
}: OnboardParams): Promise<OnboardResult> {
  const existing = await transaction.query.pjClientCategories.findMany({
    where: and(eq(pjClientCategories.orgId, orgId), eq(pjClientCategories.clientId, clientId)),
    orderBy: [
      asc(pjClientCategories.level),
      asc(pjClientCategories.sortOrder),
      asc(pjClientCategories.id),
    ],
  });

  if (existing.length > 0) {
    const normalized = existing.map(normalizeClientCategory);
    await storage.setPjClientCategories(orgId, clientId, normalized);
    logger?.info("PJ client categories already provisioned", {
      event: "pj.client.onboarding",
      clientId,
      context: { orgId, categories: normalized.length, created: false },
    });
    return { created: false, categories: normalized };
  }

  const baseCategories = await transaction.query.pjCategories.findMany({
    where: eq(pjCategories.isActive, true),
    orderBy: [
      asc(pjCategories.level),
      asc(pjCategories.sortOrder),
      asc(pjCategories.code),
    ],
  });

  if (baseCategories.length === 0) {
    throw new Error("Nenhuma categoria base PJ ativa encontrada para clonagem");
  }

  const byBaseId = new Map<string, PjClientCategoryRecord>();
  const clones: PjClientCategoryRecord[] = [];

  for (const base of baseCategories) {
    if (!base.id) {
      throw new Error("Categoria base PJ sem ID");
    }

    let parentId: string | null = null;
    let level = 0;
    let parentPath: string | undefined;

    if (base.parentId) {
      const parent = byBaseId.get(base.parentId);
      if (!parent) {
        throw new Error(`Categoria base ${base.id} depende de pai ${base.parentId} não encontrado`);
      }
      parentId = parent.id;
      level = parent.level + 1;
      parentPath = parent.path;
    }

    const id = randomUUID();
    const path = parentPath ? `${parentPath}.${id}` : id;

    const clone: PjClientCategoryRecord = {
      id,
      orgId,
      clientId,
      baseCategoryId: base.id,
      parentId,
      level,
      path,
      sortOrder: base.sortOrder,
    };

    clones.push(clone);
    byBaseId.set(base.id, clone);
  }

  await transaction.insert(pjClientCategories).values(clones);
  await storage.setPjClientCategories(orgId, clientId, clones);

  logger?.info("PJ client categories provisioned", {
    event: "pj.client.onboarding",
    clientId,
    context: { orgId, categories: clones.length, created: true },
  });

  return { created: true, categories: clones };
}
