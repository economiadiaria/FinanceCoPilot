import type {
  PjCategory,
  PjClientCategoryNode,
  PjGlobalCategoryNode,
} from "@shared/schema";

export type PjClientCategoryRecord = import("./storage").PjClientCategoryRecord;

type TreeNodeLike<TNode> = {
  id: string;
  parentId: string | null;
  sortOrder: number;
  name: string;
  children: TNode[];
};

export function sanitizeGlobalCategory(category: PjCategory): PjGlobalCategoryNode {
  return {
    type: "global",
    id: category.id,
    code: category.code,
    name: category.name,
    description: category.description ?? null,
    parentId: category.parentId ?? null,
    acceptsPostings: category.acceptsPostings,
    level: category.level,
    path: category.path,
    sortOrder: category.sortOrder,
    isCore: category.isCore,
    children: [],
  };
}

export function sanitizeClientCategory(
  category: PjClientCategoryRecord,
): PjClientCategoryNode {
  return {
    type: "client",
    id: category.id,
    baseCategoryId: category.baseCategoryId ?? null,
    name: category.name,
    description: category.description ?? null,
    parentId: category.parentId ?? null,
    acceptsPostings: category.acceptsPostings,
    level: category.level,
    path: category.path,
    sortOrder: category.sortOrder,
    children: [],
  };
}

export function normalizeCategoryName(name: string): string {
  return name.trim().toLocaleLowerCase("pt-BR");
}

export function hasDuplicateCategoryName<
  T extends { id: string; name: string },
>(categories: readonly T[], candidateName: string, ignoreId?: string): boolean {
  const normalized = normalizeCategoryName(candidateName);
  return categories.some(category => {
    if (ignoreId && category.id === ignoreId) {
      return false;
    }
    return normalizeCategoryName(category.name) === normalized;
  });
}

export function buildCategoryTree<TItem, TNode extends TreeNodeLike<TNode>>(
  items: readonly TItem[],
  toNode: (item: TItem) => TNode,
): TNode[] {
  const nodeMap = new Map<string, TNode>();
  const roots: TNode[] = [];

  for (const item of items) {
    const node = toNode(item);
    nodeMap.set(node.id, node);
  }

  for (const node of nodeMap.values()) {
    if (node.parentId && nodeMap.has(node.parentId)) {
      nodeMap.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortBranch = (branch: TNode[]): void => {
    branch.sort((a, b) => {
      if (a.sortOrder === b.sortOrder) {
        return a.name.localeCompare(b.name, "pt-BR");
      }
      return a.sortOrder - b.sortOrder;
    });
    branch.forEach(child => sortBranch(child.children));
  };

  sortBranch(roots);
  return roots;
}

export function sortCategoriesByOrder<T extends { sortOrder: number; name: string }>(
  categories: readonly T[],
): T[] {
  return [...categories].sort((a, b) => {
    if (a.sortOrder === b.sortOrder) {
      return a.name.localeCompare(b.name, "pt-BR");
    }
    return a.sortOrder - b.sortOrder;
  });
}

export function computeGlobalHierarchy(
  categories: readonly PjCategory[],
  parentId: string | null | undefined,
) {
  if (!parentId) {
    return { level: 1, path: "" } as const;
  }

  const parent = categories.find(category => category.id === parentId);
  if (!parent) {
    throw new Error("Categoria pai não encontrada");
  }

  return {
    level: parent.level + 1,
    path: parent.path,
  } as const;
}

export function computeClientHierarchy(
  categories: readonly PjClientCategoryRecord[],
  parentId: string | null | undefined,
) {
  if (!parentId) {
    return { level: 0, path: "" } as const;
  }

  const parent = categories.find(category => category.id === parentId);
  if (!parent) {
    throw new Error("Categoria pai não encontrada");
  }

  return {
    level: parent.level + 1,
    path: parent.path,
  } as const;
}

export function assertNoCategoryCycle<
  T extends { id: string; parentId: string | null | undefined },
>(
  categories: readonly T[],
  categoryId: string,
  candidateParentId: string | null | undefined,
) {
  if (!candidateParentId) {
    return;
  }

  if (candidateParentId === categoryId) {
    throw new Error("Categoria pai inválida");
  }

  let cursor: string | null | undefined = candidateParentId;
  const guard = new Set<string>();

  while (cursor) {
    if (cursor === categoryId) {
      throw new Error("Categoria pai criaria um ciclo");
    }

    if (guard.has(cursor)) {
      // Defensive guard against malformed graphs
      break;
    }

    guard.add(cursor);
    const parent = categories.find(category => category.id === cursor);
    if (!parent) {
      break;
    }
    cursor = parent.parentId;
  }
}
