import type { BankTransaction } from "@shared/schema";
import {
  getLedgerGroup,
  ledgerGroupLabels,
  ledgerGroupSortOrder,
  type LedgerGroup,
} from "./pj-ledger-groups";

const BASE_CATEGORY_TO_LEDGER: Record<string, LedgerGroup> = {
  "seed-pj-category-receita": "RECEITA",
  "seed-pj-category-deducoes-receita": "DEDUCOES_RECEITA",
  "seed-pj-category-gea": "GEA",
  "seed-pj-category-comercial-mkt": "COMERCIAL_MKT",
  "seed-pj-category-financeiras": "FINANCEIRAS",
  "seed-pj-category-outras": "OUTRAS",
};

export interface CategoryLike {
  id: string;
  name: string;
  path: string;
  level: number;
  sortOrder?: number | null;
  parentId?: string | null;
  acceptsPostings?: boolean | null;
  baseCategoryId?: string | null;
}

interface CategoryDefinition {
  id: string;
  label: string;
  path: string;
  level: number;
  sortOrder: number;
  parentPath: string | null;
  acceptsPostings: boolean;
  baseCategoryId: string | null;
  group: LedgerGroup;
}

interface CategoryDefinitionIndex {
  byPath: Map<string, CategoryDefinition>;
  byId: Map<string, CategoryDefinition>;
  ledgerByGroup: Map<LedgerGroup, CategoryDefinition>;
}

interface NodeTotals {
  inflows: number;
  outflows: number;
}

interface CategoryNodeInternal {
  definition: CategoryDefinition;
  inflows: number;
  outflows: number;
  directInflows: number;
  directOutflows: number;
  children: CategoryNodeInternal[];
}

export interface CategoryHierarchyNode {
  id: string;
  label: string;
  path: string;
  level: number;
  sortOrder: number;
  parentPath: string | null;
  acceptsPostings: boolean;
  baseCategoryId: string | null;
  group: LedgerGroup;
  inflows: number;
  outflows: number;
  net: number;
  directInflows: number;
  directOutflows: number;
  children: CategoryHierarchyNode[];
}

export interface CategoryHierarchyResult {
  roots: CategoryHierarchyNode[];
  nodesByPath: Map<string, CategoryHierarchyNode>;
  ledgerByGroup: Map<LedgerGroup, CategoryHierarchyNode>;
}

export interface CategoryAggregationOptions {
  categories?: CategoryLike[];
  ledgerGroupResolver?: (tx: BankTransaction) => LedgerGroup;
}

function resolveLedgerGroup(
  category: CategoryLike | undefined,
  categoryById: Map<string, CategoryLike>,
  cache: Map<string, LedgerGroup>,
): LedgerGroup {
  if (!category) {
    return "OUTRAS";
  }

  const cached = cache.get(category.id);
  if (cached) {
    return cached;
  }

  const baseGroup = category.baseCategoryId ? BASE_CATEGORY_TO_LEDGER[category.baseCategoryId] : undefined;
  if (baseGroup) {
    cache.set(category.id, baseGroup);
    return baseGroup;
  }

  if (category.parentId) {
    const parent = categoryById.get(category.parentId);
    const resolved = resolveLedgerGroup(parent, categoryById, cache);
    cache.set(category.id, resolved);
    return resolved;
  }

  const fallback = "OUTRAS" satisfies LedgerGroup;
  cache.set(category.id, fallback);
  return fallback;
}

function buildCategoryDefinitionIndex(categories: CategoryLike[]): CategoryDefinitionIndex {
  const byPath = new Map<string, CategoryDefinition>();
  const byId = new Map<string, CategoryDefinition>();
  const ledgerByGroup = new Map<LedgerGroup, CategoryDefinition>();

  const categoryById = new Map<string, CategoryLike>();
  for (const category of categories) {
    categoryById.set(category.id, category);
  }

  for (const group of Object.keys(ledgerGroupLabels) as LedgerGroup[]) {
    const definition: CategoryDefinition = {
      id: `ledger:${group}`,
      label: ledgerGroupLabels[group],
      path: `ledger:${group}`,
      level: 0,
      sortOrder: ledgerGroupSortOrder[group] ?? 0,
      parentPath: null,
      acceptsPostings: false,
      baseCategoryId: null,
      group,
    };
    byPath.set(definition.path, definition);
    ledgerByGroup.set(group, definition);
  }

  const groupCache = new Map<string, LedgerGroup>();

  for (const category of categories) {
    if (!category.path) {
      continue;
    }

    const group = resolveLedgerGroup(category, categoryById, groupCache);
    const parentCategory = category.parentId ? categoryById.get(category.parentId) : undefined;
    const parentPath = parentCategory?.path ?? ledgerByGroup.get(group)?.path ?? null;

    const acceptsPostings = category.acceptsPostings ?? true;
    const definition: CategoryDefinition = {
      id: category.id,
      label: category.name ?? "Categoria",
      path: category.path,
      level: category.level ?? 0,
      sortOrder: category.sortOrder ?? 0,
      parentPath,
      acceptsPostings,
      baseCategoryId: category.baseCategoryId ?? null,
      group,
    };

    byPath.set(definition.path, definition);
    byId.set(definition.id, definition);
  }

  return { byPath, byId, ledgerByGroup };
}

function ensureTotals(map: Map<string, NodeTotals>, key: string): NodeTotals {
  const existing = map.get(key);
  if (existing) {
    return existing;
  }
  const created: NodeTotals = { inflows: 0, outflows: 0 };
  map.set(key, created);
  return created;
}

function ensureNode(nodes: Map<string, CategoryNodeInternal>, definition: CategoryDefinition): CategoryNodeInternal {
  const existing = nodes.get(definition.path);
  if (existing) {
    return existing;
  }
  const created: CategoryNodeInternal = {
    definition,
    inflows: 0,
    outflows: 0,
    directInflows: 0,
    directOutflows: 0,
    children: [],
  };
  nodes.set(definition.path, created);
  return created;
}

function toHierarchyNode(
  node: CategoryNodeInternal,
  map: Map<string, CategoryHierarchyNode>,
): CategoryHierarchyNode {
  const converted: CategoryHierarchyNode = {
    id: node.definition.id,
    label: node.definition.label,
    path: node.definition.path,
    level: node.definition.level,
    sortOrder: node.definition.sortOrder,
    parentPath: node.definition.parentPath,
    acceptsPostings: node.definition.acceptsPostings,
    baseCategoryId: node.definition.baseCategoryId,
    group: node.definition.group,
    inflows: node.inflows,
    outflows: node.outflows,
    net: node.inflows - node.outflows,
    directInflows: node.directInflows,
    directOutflows: node.directOutflows,
    children: [],
  };

  map.set(converted.path, converted);
  return converted;
}

function sortHierarchy(node: CategoryHierarchyNode): void {
  node.children.sort((a, b) => {
    const sortDiff = a.sortOrder - b.sortOrder;
    if (sortDiff !== 0) {
      return sortDiff;
    }
    return a.label.localeCompare(b.label);
  });

  for (const child of node.children) {
    sortHierarchy(child);
  }
}

export function aggregateTransactionsByCategory(
  transactions: BankTransaction[],
  options: CategoryAggregationOptions = {},
): CategoryHierarchyResult {
  const definitions = buildCategoryDefinitionIndex(options.categories ?? []);
  const ledgerGroupResolver = options.ledgerGroupResolver ?? getLedgerGroup;

  const totalsByPath = new Map<string, NodeTotals>();

  for (const tx of transactions) {
    const ledgerGroup = ledgerGroupResolver(tx);
    const categorized = tx.categorizedAs;

    let targetPath: string | undefined;
    if (categorized?.categoryPath && definitions.byPath.has(categorized.categoryPath)) {
      targetPath = categorized.categoryPath;
    } else if (categorized?.categoryId) {
      const definition = definitions.byId.get(categorized.categoryId);
      if (definition) {
        targetPath = definition.path;
      }
    }

    if (targetPath) {
      const definition = definitions.byPath.get(targetPath);
      if (definition && !definition.acceptsPostings) {
        targetPath = undefined;
      }
    }

    if (!targetPath) {
      const ledgerDefinition = definitions.ledgerByGroup.get(ledgerGroup);
      targetPath = ledgerDefinition?.path;
    }

    if (!targetPath) {
      // Fallback to a synthetic ledger definition when not present in the index.
      const syntheticPath = `ledger:${ledgerGroup}`;
      const syntheticDefinition: CategoryDefinition = {
        id: syntheticPath,
        label: ledgerGroupLabels[ledgerGroup],
        path: syntheticPath,
        level: 0,
        sortOrder: ledgerGroupSortOrder[ledgerGroup] ?? 0,
        parentPath: null,
        acceptsPostings: false,
        baseCategoryId: null,
        group: ledgerGroup,
      };
      definitions.byPath.set(syntheticPath, syntheticDefinition);
      definitions.ledgerByGroup.set(ledgerGroup, syntheticDefinition);
      targetPath = syntheticPath;
    }

    const totals = ensureTotals(totalsByPath, targetPath);
    if (tx.amount >= 0) {
      totals.inflows += tx.amount;
    } else {
      totals.outflows += Math.abs(tx.amount);
    }
  }

  const nodes = new Map<string, CategoryNodeInternal>();

  for (const [path, totals] of totalsByPath.entries()) {
    let currentPath: string | null | undefined = path;
    let level = 0;
    while (currentPath) {
      const definition = definitions.byPath.get(currentPath);
      if (!definition) {
        break;
      }
      const node = ensureNode(nodes, definition);
      node.inflows += totals.inflows;
      node.outflows += totals.outflows;
      if (level === 0) {
        node.directInflows += totals.inflows;
        node.directOutflows += totals.outflows;
      }
      currentPath = definition.parentPath;
      level += 1;
    }
  }

  for (const node of nodes.values()) {
    if (!node.definition.parentPath) {
      continue;
    }
    const parent = nodes.get(node.definition.parentPath);
    if (parent) {
      parent.children.push(node);
    }
  }

  const hierarchyByPath = new Map<string, CategoryHierarchyNode>();
  const hierarchyNodes = new Map<string, CategoryHierarchyNode>();

  for (const node of nodes.values()) {
    toHierarchyNode(node, hierarchyByPath);
  }

  for (const node of nodes.values()) {
    const converted = hierarchyByPath.get(node.definition.path);
    if (!converted) {
      continue;
    }
    if (!node.definition.parentPath) {
      hierarchyNodes.set(node.definition.path, converted);
      continue;
    }
    const parent = hierarchyByPath.get(node.definition.parentPath);
    if (parent) {
      parent.children.push(converted);
    }
  }

  const roots: CategoryHierarchyNode[] = [];
  for (const node of hierarchyByPath.values()) {
    if (!node.parentPath) {
      roots.push(node);
    }
  }

  for (const root of roots) {
    sortHierarchy(root);
  }

  const ledgerByGroup = new Map<LedgerGroup, CategoryHierarchyNode>();
  for (const group of Object.keys(ledgerGroupLabels) as LedgerGroup[]) {
    const ledgerDefinition = definitions.ledgerByGroup.get(group);
    if (!ledgerDefinition) {
      continue;
    }
    const node = hierarchyByPath.get(ledgerDefinition.path);
    if (node) {
      ledgerByGroup.set(group, node);
    }
  }

  return {
    roots: roots.sort((a, b) => {
      const sortDiff = a.sortOrder - b.sortOrder;
      if (sortDiff !== 0) {
        return sortDiff;
      }
      return a.label.localeCompare(b.label);
    }),
    nodesByPath: hierarchyByPath,
    ledgerByGroup,
  };
}
