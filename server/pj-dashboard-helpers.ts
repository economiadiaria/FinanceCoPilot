import type { BankTransaction, Sale } from "@shared/schema";
import { getMonthKey, inPeriod, toISOFromBR } from "@shared/utils";
import {
  aggregateTransactionsByCategory,
  type CategoryHierarchyNode,
  type CategoryHierarchyResult,
  type CategoryLike,
} from "./pj-category-aggregation";
import {
  getLedgerGroup,
  ledgerGroupLabels,
  ledgerGroupSortOrder,
  type LedgerGroup,
} from "./pj-ledger-groups";

const DEFAULT_MONTH_SUMMARY = {
  faturamento: 0,
  receita: 0,
  despesas: 0,
  saldo: 0,
  lucroBruto: 0,
  lucroLiquido: 0,
  margemLiquida: 0,
  ticketMedio: 0,
  quantidadeVendas: 0,
  deducoesReceita: 0,
  despesasGerais: 0,
  despesasComercialMarketing: 0,
  financeiroIn: 0,
  financeiroOut: 0,
  outrasIn: 0,
  outrasOut: 0,
};

function getSubcategoryLabel(tx: BankTransaction, group: LedgerGroup): string {
  if (tx.categorizedAs?.subcategory) {
    return tx.categorizedAs.subcategory;
  }

  if (tx.dfcItem) {
    return tx.dfcItem;
  }

  if (group === "RECEITA") {
    const accountLabel = tx.bankAccountId ?? tx.accountId;
    if (accountLabel) {
      return `Conta ${accountLabel}`;
    }
  }

  return tx.desc;
}

interface LedgerGroupTotals {
  inflows: number;
  outflows: number;
  net: number;
}

interface MonthlyComputation {
  month: string;
  transactions: BankTransaction[];
  sales: Sale[];
  categoryHierarchy: CategoryHierarchyResult;
  ledgerTotals: Map<LedgerGroup, LedgerGroupTotals>;
  uncategorizedExpenses: BankTransaction[];
  summary: typeof DEFAULT_MONTH_SUMMARY;
}

function computeMonthlyData(
  month: string,
  bankTxs: BankTransaction[],
  sales: Sale[],
  categories: CategoryLike[] = [],
): MonthlyComputation {
  const txsInMonth = bankTxs.filter((tx) => inPeriod(tx.date, month));
  const salesInMonth = sales.filter((sale) => inPeriod(sale.date, month));

  const categoryHierarchy = aggregateTransactionsByCategory(txsInMonth, {
    categories,
    ledgerGroupResolver: getLedgerGroup,
  });

  const ledgerTotals = new Map<LedgerGroup, LedgerGroupTotals>();
  for (const group of Object.keys(ledgerGroupLabels) as LedgerGroup[]) {
    const node = categoryHierarchy.ledgerByGroup.get(group);
    ledgerTotals.set(group, {
      inflows: node?.inflows ?? 0,
      outflows: node?.outflows ?? 0,
      net: node?.net ?? 0,
    });
  }

  const uncategorized: BankTransaction[] = [];
  for (const tx of txsInMonth) {
    if (
      tx.amount < 0 &&
      !tx.categorizedAs?.categoryPath &&
      !tx.categorizedAs?.categoryId &&
      !tx.categorizedAs?.group &&
      !tx.dfcCategory
    ) {
      uncategorized.push(tx);
    }
  }

  const faturamento = salesInMonth.reduce((sum, sale) => sum + (sale.grossAmount ?? 0), 0);
  const totalReceita = ledgerTotals.get("RECEITA")?.inflows ?? 0;
  const totalDespesas = Array.from(ledgerTotals.values()).reduce((sum, totals) => sum + totals.outflows, 0);
  const saldo = txsInMonth.reduce((sum, tx) => sum + tx.amount, 0);

  const deducoes = ledgerTotals.get("DEDUCOES_RECEITA")?.outflows ?? 0;
  const despesasGerais = ledgerTotals.get("GEA")?.outflows ?? 0;
  const despesasComercialMarketing = ledgerTotals.get("COMERCIAL_MKT")?.outflows ?? 0;
  const financeiroIn = ledgerTotals.get("FINANCEIRAS")?.inflows ?? 0;
  const financeiroOut = ledgerTotals.get("FINANCEIRAS")?.outflows ?? 0;
  const outrasIn = ledgerTotals.get("OUTRAS")?.inflows ?? 0;
  const outrasOut = ledgerTotals.get("OUTRAS")?.outflows ?? 0;

  const lucroBruto = totalReceita - deducoes;
  const lucroLiquido =
    lucroBruto - (despesasGerais + despesasComercialMarketing + financeiroOut + outrasOut) + financeiroIn + outrasIn;
  const margemLiquida = totalReceita > 0 ? (lucroLiquido / totalReceita) * 100 : 0;
  const ticketMedio = salesInMonth.length > 0 ? faturamento / salesInMonth.length : 0;

  const summary = {
    faturamento,
    receita: totalReceita,
    despesas: totalDespesas,
    saldo,
    lucroBruto,
    lucroLiquido,
    margemLiquida,
    ticketMedio,
    quantidadeVendas: salesInMonth.length,
    deducoesReceita: deducoes,
    despesasGerais,
    despesasComercialMarketing,
    financeiroIn,
    financeiroOut,
    outrasIn,
    outrasOut,
  };

  return {
    month,
    transactions: txsInMonth,
    sales: salesInMonth,
    categoryHierarchy,
    ledgerTotals,
    uncategorizedExpenses: uncategorized,
    summary,
  };
}

export function collectAvailableMonths(bankTxs: BankTransaction[], sales: Sale[]): string[] {
  const months = new Set<string>();

  for (const tx of bankTxs) {
    if (tx.date) {
      months.add(getMonthKey(tx.date));
    }
  }

  for (const sale of sales) {
    if (sale.date) {
      months.add(getMonthKey(sale.date));
    }
  }

  return Array.from(months).sort((a, b) => (a > b ? -1 : 1));
}

function formatDailyCashEvolution(transactions: BankTransaction[]) {
  const daily = new Map<string, number>();

  for (const tx of transactions) {
    if (!tx.date) continue;
    const isoDate = toISOFromBR(tx.date);
    daily.set(isoDate, (daily.get(isoDate) ?? 0) + tx.amount);
  }

  const sortedDates = Array.from(daily.keys()).sort();
  let running = 0;
  const labels: string[] = [];
  const saldo: number[] = [];

  for (const date of sortedDates) {
    running += daily.get(date)!;
    labels.push(new Date(date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }));
    saldo.push(running);
  }

  return { labels, saldo };
}

function buildRevenueChannels(sales: Sale[], faturamento: number) {
  const byChannel = new Map<string, { total: number; count: number }>();

  for (const sale of sales) {
    const key = sale.channel || "Canal indefinido";
    const current = byChannel.get(key) ?? { total: 0, count: 0 };
    current.total += sale.grossAmount ?? 0;
    current.count += 1;
    byChannel.set(key, current);
  }

  const totalBase = faturamento || Array.from(byChannel.values()).reduce((sum, c) => sum + c.total, 0);

  return Array.from(byChannel.entries())
    .map(([channel, data]) => ({
      channel,
      total: data.total,
      count: data.count,
      percentage: totalBase > 0 ? (data.total / totalBase) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

function buildTopSales(sales: Sale[]) {
  return sales
    .map((sale) => ({
      saleId: sale.saleId,
      date: sale.date,
      amount: sale.grossAmount ?? 0,
      netAmount: sale.netAmount ?? sale.grossAmount ?? 0,
      customer: sale.customer?.name || sale.customer?.email || "Cliente sem nome",
      channel: sale.channel,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
}

function findCategoryNode(
  hierarchy: CategoryHierarchyResult,
  categoryId?: string | null,
  categoryPath?: string | null,
): CategoryHierarchyNode | undefined {
  if (categoryPath && hierarchy.nodesByPath.has(categoryPath)) {
    return hierarchy.nodesByPath.get(categoryPath);
  }

  if (categoryId) {
    for (const node of hierarchy.nodesByPath.values()) {
      if (node.id === categoryId) {
        return node;
      }
    }
  }

  return undefined;
}

function buildTopCosts(transactions: BankTransaction[], hierarchy: CategoryHierarchyResult) {
  return transactions
    .filter((tx) => tx.amount < 0)
    .map((tx) => {
      const group = getLedgerGroup(tx);
      const node = findCategoryNode(hierarchy, tx.categorizedAs?.categoryId, tx.categorizedAs?.categoryPath);
      const fallbackLabel = getSubcategoryLabel(tx, group);

      return {
        bankTxId: tx.bankTxId,
        date: tx.date,
        desc: tx.desc,
        amount: Math.abs(tx.amount),
        group,
        groupLabel: ledgerGroupLabels[group],
        categoryPath: node?.path ?? tx.categorizedAs?.categoryPath ?? null,
        categoryLabel: node?.label ?? tx.categorizedAs?.subcategory ?? fallbackLabel,
        categoryLevel: node?.level ?? null,
        categoryAcceptsPostings: node?.acceptsPostings ?? null,
      };
    })
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);
}

export function buildMonthlyInsights(
  bankTxs: BankTransaction[],
  sales: Sale[],
  month?: string | null,
  historyWindow = 6,
  categories: CategoryLike[] = [],
) {
  const availableMonths = collectAvailableMonths(bankTxs, sales);
  const targetMonth = month && availableMonths.includes(month) ? month : availableMonths[0] ?? null;

  if (!targetMonth) {
    return {
      month: null,
      availableMonths,
      summary: { ...DEFAULT_MONTH_SUMMARY },
      charts: {
        faturamentoVsReceita: { labels: [], faturamento: [], receita: [] },
        lucroEMargem: { labels: [], lucroLiquido: [], margemLiquida: [] },
        evolucaoCaixa: { labels: [], saldo: [] },
      },
      highlights: {
        topVendas: [],
        topCustos: [],
        origemReceita: [],
        despesasNaoCategorizadas: { total: 0, count: 0, items: [] },
      },
    } as const;
  }

  const current = computeMonthlyData(targetMonth, bankTxs, sales, categories);

  const chronologicalMonths = [...availableMonths].sort();
  const recentMonths = chronologicalMonths.slice(-historyWindow);
  const historySummaries = recentMonths.map((m) => computeMonthlyData(m, bankTxs, sales, categories).summary);

  const faturamentoSeries = {
    labels: recentMonths,
    faturamento: historySummaries.map((s) => s.faturamento),
    receita: historySummaries.map((s) => s.receita),
  };

  const lucroMargemSeries = {
    labels: recentMonths,
    lucroLiquido: historySummaries.map((s) => s.lucroLiquido),
    margemLiquida: historySummaries.map((s) => s.margemLiquida),
  };

  const cashEvolution = formatDailyCashEvolution(current.transactions);

  const topVendas = buildTopSales(current.sales);
  const topCustos = buildTopCosts(current.transactions, current.categoryHierarchy);
  const origemReceita = buildRevenueChannels(current.sales, current.summary.faturamento);

  const uncategorizedTotal = current.uncategorizedExpenses.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const despesasNaoCategorizadas = {
    total: uncategorizedTotal,
    count: current.uncategorizedExpenses.length,
    items: current.uncategorizedExpenses
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 10)
      .map((tx) => ({
        bankTxId: tx.bankTxId,
        date: tx.date,
        desc: tx.desc,
        amount: Math.abs(tx.amount),
      })),
  };

  return {
    month: targetMonth,
    availableMonths,
    summary: current.summary,
    charts: {
      faturamentoVsReceita: faturamentoSeries,
      lucroEMargem: lucroMargemSeries,
      evolucaoCaixa: cashEvolution,
    },
    highlights: {
      topVendas,
      topCustos,
      origemReceita,
      despesasNaoCategorizadas,
    },
  };
}

interface CostBreakdownNode {
  key: string;
  label: string;
  inflows: number;
  outflows: number;
  net: number;
  categoryId: string | null;
  categoryPath: string;
  level: number;
  group: LedgerGroup;
  acceptsPostings: boolean;
  sortOrder: number;
  directInflows: number;
  directOutflows: number;
  children: CostBreakdownNode[];
}

function convertHierarchyToBreakdown(node: CategoryHierarchyNode): CostBreakdownNode {
  return {
    key: node.path,
    label: node.label,
    inflows: node.inflows,
    outflows: node.outflows,
    net: node.net,
    categoryId: node.id,
    categoryPath: node.path,
    level: node.level,
    group: node.group,
    acceptsPostings: node.acceptsPostings,
    sortOrder: node.sortOrder,
    directInflows: node.directInflows,
    directOutflows: node.directOutflows,
    children: node.children
      .filter((child) => child.inflows !== 0 || child.outflows !== 0 || child.children.length > 0)
      .map(convertHierarchyToBreakdown),
  };
}

export function buildCostBreakdown(
  bankTxs: BankTransaction[],
  sales: Sale[],
  month?: string | null,
  categories: CategoryLike[] = [],
) {
  const availableMonths = collectAvailableMonths(bankTxs, sales);
  const targetMonth = month && availableMonths.includes(month) ? month : availableMonths[0] ?? null;

  if (!targetMonth) {
    return {
      month: null,
      availableMonths,
      totals: { inflows: 0, outflows: 0, net: 0 },
      groups: [],
      uncategorized: { total: 0, count: 0, items: [] },
    } as const;
  }

  const current = computeMonthlyData(targetMonth, bankTxs, sales, categories);

  const groups: Array<{
    key: string;
    label: string;
    inflows: number;
    outflows: number;
    net: number;
    group: LedgerGroup;
    items: CostBreakdownNode[];
  }> = [];

  for (const group of Object.keys(ledgerGroupLabels) as LedgerGroup[]) {
    const node = current.categoryHierarchy.ledgerByGroup.get(group);
    if (!node) {
      continue;
    }

    const breakdownNode = convertHierarchyToBreakdown(node);
    const hasActivity =
      breakdownNode.inflows !== 0 ||
      breakdownNode.outflows !== 0 ||
      breakdownNode.children.length > 0;

    if (!hasActivity) {
      continue;
    }

    groups.push({
      key: group,
      label: ledgerGroupLabels[group],
      inflows: breakdownNode.inflows,
      outflows: breakdownNode.outflows,
      net: breakdownNode.net,
      group,
      items: breakdownNode.children,
    });
  }

  groups.sort((a, b) => {
    const orderDiff = (ledgerGroupSortOrder[a.group] ?? 0) - (ledgerGroupSortOrder[b.group] ?? 0);
    if (orderDiff !== 0) {
      return orderDiff;
    }
    return a.label.localeCompare(b.label);
  });

  const totals = groups.reduce(
    (acc, group) => {
      acc.inflows += group.inflows;
      acc.outflows += group.outflows;
      return acc;
    },
    { inflows: 0, outflows: 0, net: 0 },
  );
  totals.net = totals.inflows - totals.outflows;

  const uncategorizedTotal = current.uncategorizedExpenses.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

  const uncategorized = {
    total: uncategorizedTotal,
    count: current.uncategorizedExpenses.length,
    items: current.uncategorizedExpenses
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 10)
      .map((tx) => ({
        bankTxId: tx.bankTxId,
        date: tx.date,
        desc: tx.desc,
        amount: Math.abs(tx.amount),
      })),
  };

  return {
    month: targetMonth,
    availableMonths,
    totals,
    groups,
    uncategorized,
  };
}

export { ledgerGroupLabels as ledgerGroupDisplay };
