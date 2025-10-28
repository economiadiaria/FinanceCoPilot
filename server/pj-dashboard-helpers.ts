import type { BankTransaction, Sale } from "@shared/schema";
import { ledgerGroups } from "@shared/schema";
import { getMonthKey, inPeriod, toISOFromBR } from "@shared/utils";

export type LedgerGroup = (typeof ledgerGroups)[number];

interface GroupAccumulator {
  inflows: number;
  outflows: number;
  subitems: Map<string, SubitemAccumulator>;
}

interface SubitemAccumulator {
  label: string;
  inflows: number;
  outflows: number;
}

const ledgerGroupLabels: Record<LedgerGroup, string> = {
  RECEITA: "Receitas",
  DEDUCOES_RECEITA: "(-) Deduções da Receita",
  GEA: "(-) Despesas Gerais e Administrativas",
  COMERCIAL_MKT: "(-) Despesas Comerciais e Marketing",
  FINANCEIRAS: "(-/+) Despesas e Receitas Financeiras",
  OUTRAS: "(-/+) Outras Despesas e Receitas Não Operacionais",
};

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

function normalizeString(value?: string | null): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .toUpperCase();
}

function inferGroupFromLegacy(value: string | undefined, amount: number): LedgerGroup | undefined {
  if (!value) return undefined;
  const normalized = normalizeString(value);

  if (normalized.includes("DEDU")) {
    return "DEDUCOES_RECEITA";
  }
  if (normalized.includes("GER") || normalized.includes("ADM")) {
    return "GEA";
  }
  if (normalized.includes("COM") || normalized.includes("MARK")) {
    return "COMERCIAL_MKT";
  }
  if (normalized.includes("FINAN")) {
    return "FINANCEIRAS";
  }
  if (normalized.includes("RECEITA") || normalized.includes("FATUR")) {
    return amount >= 0 ? "RECEITA" : "DEDUCOES_RECEITA";
  }
  if (normalized.includes("OUTR")) {
    return "OUTRAS";
  }

  return undefined;
}

function getLedgerGroup(tx: BankTransaction): LedgerGroup {
  if (tx.categorizedAs?.group) {
    return tx.categorizedAs.group;
  }

  const legacy = inferGroupFromLegacy(tx.dfcCategory, tx.amount) || inferGroupFromLegacy(tx.dfcItem, tx.amount);
  if (legacy) {
    return legacy;
  }

  return tx.amount >= 0 ? "RECEITA" : "OUTRAS";
}

function getSubcategoryLabel(tx: BankTransaction, group: LedgerGroup): string {
  if (tx.categorizedAs?.subcategory) {
    return tx.categorizedAs.subcategory;
  }

  if (tx.dfcItem) {
    return tx.dfcItem;
  }

  if (group === "RECEITA" && tx.accountId) {
    return `Conta ${tx.accountId}`;
  }

  return tx.desc;
}

function ensureGroupAccumulator(map: Map<LedgerGroup, GroupAccumulator>, group: LedgerGroup): GroupAccumulator {
  if (!map.has(group)) {
    map.set(group, { inflows: 0, outflows: 0, subitems: new Map() });
  }
  return map.get(group)!;
}

function ensureSubitemAccumulator(group: GroupAccumulator, key: string, label: string): SubitemAccumulator {
  if (!group.subitems.has(key)) {
    group.subitems.set(key, { label, inflows: 0, outflows: 0 });
  }
  return group.subitems.get(key)!;
}

interface MonthlyComputation {
  month: string;
  transactions: BankTransaction[];
  sales: Sale[];
  groupTotals: Map<LedgerGroup, GroupAccumulator>;
  uncategorizedExpenses: BankTransaction[];
  summary: typeof DEFAULT_MONTH_SUMMARY;
}

function computeMonthlyData(month: string, bankTxs: BankTransaction[], sales: Sale[]): MonthlyComputation {
  const txsInMonth = bankTxs.filter((tx) => inPeriod(tx.date, month));
  const salesInMonth = sales.filter((sale) => inPeriod(sale.date, month));

  const groupTotals = new Map<LedgerGroup, GroupAccumulator>();
  const uncategorized: BankTransaction[] = [];

  for (const tx of txsInMonth) {
    const group = getLedgerGroup(tx);
    const groupAcc = ensureGroupAccumulator(groupTotals, group);
    const subKey = getSubcategoryLabel(tx, group);
    const subAcc = ensureSubitemAccumulator(groupAcc, subKey, subKey);

    if (tx.amount >= 0) {
      groupAcc.inflows += tx.amount;
      subAcc.inflows += tx.amount;
    } else {
      const absAmount = Math.abs(tx.amount);
      groupAcc.outflows += absAmount;
      subAcc.outflows += absAmount;
      if (!tx.categorizedAs?.group && !tx.dfcCategory) {
        uncategorized.push(tx);
      }
    }
  }

  const faturamento = salesInMonth.reduce((sum, sale) => sum + (sale.grossAmount ?? 0), 0);
  const totalReceita = txsInMonth
    .filter((tx) => tx.amount > 0 && getLedgerGroup(tx) === "RECEITA")
    .reduce((sum, tx) => sum + tx.amount, 0);
  const totalDespesas = txsInMonth
    .filter((tx) => tx.amount < 0)
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const saldo = txsInMonth.reduce((sum, tx) => sum + tx.amount, 0);

  const deducoes = groupTotals.get("DEDUCOES_RECEITA")?.outflows ?? 0;
  const despesasGerais = groupTotals.get("GEA")?.outflows ?? 0;
  const despesasComercialMarketing = groupTotals.get("COMERCIAL_MKT")?.outflows ?? 0;
  const financeiroIn = groupTotals.get("FINANCEIRAS")?.inflows ?? 0;
  const financeiroOut = groupTotals.get("FINANCEIRAS")?.outflows ?? 0;
  const outrasIn = groupTotals.get("OUTRAS")?.inflows ?? 0;
  const outrasOut = groupTotals.get("OUTRAS")?.outflows ?? 0;

  const lucroBruto = totalReceita - deducoes;
  const lucroLiquido = lucroBruto - (despesasGerais + despesasComercialMarketing + financeiroOut + outrasOut) + financeiroIn + outrasIn;
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
    groupTotals,
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

function buildTopCosts(transactions: BankTransaction[]) {
  return transactions
    .filter((tx) => tx.amount < 0)
    .map((tx) => ({
      bankTxId: tx.bankTxId,
      date: tx.date,
      desc: tx.desc,
      amount: Math.abs(tx.amount),
      group: getLedgerGroup(tx),
      groupLabel: ledgerGroupLabels[getLedgerGroup(tx)],
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);
}

export function buildMonthlyInsights(
  bankTxs: BankTransaction[],
  sales: Sale[],
  month?: string | null,
  historyWindow = 6,
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

  const current = computeMonthlyData(targetMonth, bankTxs, sales);

  const chronologicalMonths = [...availableMonths].sort();
  const recentMonths = chronologicalMonths.slice(-historyWindow);
  const historySummaries = recentMonths.map((m) => computeMonthlyData(m, bankTxs, sales).summary);

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
  const topCustos = buildTopCosts(current.transactions);
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

export function buildCostBreakdown(
  bankTxs: BankTransaction[],
  sales: Sale[],
  month?: string | null,
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

  const current = computeMonthlyData(targetMonth, bankTxs, sales);

  const groups = Array.from(current.groupTotals.entries()).map(([key, value]) => {
    const items = Array.from(value.subitems.entries())
      .map(([subKey, subValue]) => ({
        key: subKey,
        label: subValue.label,
        inflows: subValue.inflows,
        outflows: subValue.outflows,
        net: subValue.inflows - subValue.outflows,
      }))
      .sort((a, b) => b.outflows - a.outflows || b.inflows - a.inflows);

    return {
      key,
      label: ledgerGroupLabels[key],
      inflows: value.inflows,
      outflows: value.outflows,
      net: value.inflows - value.outflows,
      items,
    };
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
    groups: groups.sort((a, b) => b.outflows - a.outflows || b.inflows - a.inflows),
    uncategorized,
  };
}

export const ledgerGroupDisplay = ledgerGroupLabels;
