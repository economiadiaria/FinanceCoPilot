import test from "node:test";
import assert from "node:assert/strict";
import { buildCostBreakdown, buildMonthlyInsights } from "../server/pj-dashboard-helpers";
import type { BankTransaction, Sale } from "@shared/schema";

const bankTransactions: BankTransaction[] = [
  {
    bankTxId: "oct-receita-1",
    date: "02/10/2023",
    desc: "Recebimento loja",
    amount: 1000,
    accountId: "001",
    fitid: "fit-1",
    sourceHash: "hash-1",
    linkedLegs: [],
    reconciled: false,
    categorizedAs: { group: "RECEITA", auto: true },
  },
  {
    bankTxId: "oct-receita-2",
    date: "03/10/2023",
    desc: "Recebimento PIX",
    amount: 200,
    accountId: "001",
    fitid: "fit-2",
    sourceHash: "hash-1",
    linkedLegs: [],
    reconciled: false,
    categorizedAs: { group: "RECEITA", auto: true },
  },
  {
    bankTxId: "oct-deducao",
    date: "04/10/2023",
    desc: "Taxa cartão",
    amount: -150,
    accountId: "001",
    fitid: "fit-3",
    sourceHash: "hash-1",
    linkedLegs: [],
    reconciled: false,
    categorizedAs: { group: "DEDUCOES_RECEITA", subcategory: "Taxas", auto: true },
  },
  {
    bankTxId: "oct-gea",
    date: "05/10/2023",
    desc: "Aluguel escritório",
    amount: -300,
    accountId: "001",
    fitid: "fit-4",
    sourceHash: "hash-1",
    linkedLegs: [],
    reconciled: false,
    categorizedAs: { group: "GEA", subcategory: "Aluguel", auto: true },
  },
  {
    bankTxId: "oct-uncat",
    date: "06/10/2023",
    desc: "Despesa sem categoria",
    amount: -120,
    accountId: "001",
    fitid: "fit-5",
    sourceHash: "hash-1",
    linkedLegs: [],
    reconciled: false,
  },
  {
    bankTxId: "oct-com",
    date: "07/10/2023",
    desc: "Campanha marketing",
    amount: -80,
    accountId: "001",
    fitid: "fit-6",
    sourceHash: "hash-1",
    linkedLegs: [],
    reconciled: false,
    categorizedAs: { group: "COMERCIAL_MKT", subcategory: "Ads", auto: true },
  },
  {
    bankTxId: "oct-fin-pos",
    date: "08/10/2023",
    desc: "Rendimento aplicação",
    amount: 50,
    accountId: "001",
    fitid: "fit-7",
    sourceHash: "hash-1",
    linkedLegs: [],
    reconciled: false,
    categorizedAs: { group: "FINANCEIRAS", subcategory: "Juros", auto: true },
  },
  {
    bankTxId: "oct-fin-neg",
    date: "09/10/2023",
    desc: "Tarifa bancária",
    amount: -40,
    accountId: "001",
    fitid: "fit-8",
    sourceHash: "hash-1",
    linkedLegs: [],
    reconciled: false,
    categorizedAs: { group: "FINANCEIRAS", subcategory: "Tarifas", auto: true },
  },
  {
    bankTxId: "sep-receita",
    date: "15/09/2023",
    desc: "Receita setembro",
    amount: 400,
    accountId: "001",
    fitid: "fit-9",
    sourceHash: "hash-2",
    linkedLegs: [],
    reconciled: false,
    categorizedAs: { group: "RECEITA", auto: true },
  },
  {
    bankTxId: "sep-gea",
    date: "16/09/2023",
    desc: "Energia escritório",
    amount: -100,
    accountId: "001",
    fitid: "fit-10",
    sourceHash: "hash-2",
    linkedLegs: [],
    reconciled: false,
    categorizedAs: { group: "GEA", subcategory: "Energia", auto: true },
  },
];

const sales: Sale[] = [
  {
    saleId: "sale-1",
    date: "01/10/2023",
    invoiceNumber: "NFE-1",
    customer: { name: "Empresa XPTO", doc: "123", email: "cliente@xpto.com" },
    channel: "E-commerce",
    status: "aberta",
    grossAmount: 1500,
    netAmount: 1400,
    comment: undefined,
    legs: [],
  },
  {
    saleId: "sale-2",
    date: "05/10/2023",
    invoiceNumber: "NFE-2",
    customer: { name: "Cliente Loja", doc: "456", email: "loja@cliente.com" },
    channel: "Loja Física",
    status: "aberta",
    grossAmount: 500,
    netAmount: 480,
    comment: undefined,
    legs: [],
  },
  {
    saleId: "sale-3",
    date: "12/09/2023",
    invoiceNumber: "NFE-3",
    customer: { name: "Cliente Setembro", doc: "789", email: "setembro@cliente.com" },
    channel: "Marketplace",
    status: "aberta",
    grossAmount: 800,
    netAmount: 780,
    comment: undefined,
    legs: [],
  },
];

test("buildMonthlyInsights aggregates PJ metrics with imported data", () => {
  const insights = buildMonthlyInsights(bankTransactions, sales, "2023-10");

  assert.equal(insights.month, "2023-10");
  assert.deepEqual(insights.availableMonths, ["2023-10", "2023-09"]);

  assert.equal(insights.summary.faturamento, 2000);
  assert.equal(insights.summary.receita, 1200);
  assert.equal(insights.summary.lucroBruto, 1050);
  assert.equal(insights.summary.lucroLiquido, 560);
  assert.equal(insights.summary.quantidadeVendas, 2);
  assert.equal(insights.summary.ticketMedio, 1000);
  assert.equal(insights.summary.saldo, 560);

  assert.equal(insights.highlights.topVendas.length, 2);
  assert.equal(insights.highlights.topVendas[0]?.amount, 1500);
  assert.equal(insights.highlights.topCustos[0]?.amount, 300);
  assert.equal(insights.highlights.despesasNaoCategorizadas.count, 1);
  assert.equal(insights.highlights.despesasNaoCategorizadas.total, 120);

  const lastIndex = insights.charts.faturamentoVsReceita.labels.length - 1;
  assert.equal(insights.charts.faturamentoVsReceita.labels[lastIndex], "2023-10");
  assert.equal(insights.charts.faturamentoVsReceita.faturamento[lastIndex], 2000);
  assert.equal(insights.charts.lucroEMargem.lucroLiquido[lastIndex], 560);
  assert.ok(insights.charts.evolucaoCaixa.labels.length > 0);
});

test("buildCostBreakdown consolidates categories and uncategorized expenses", () => {
  const breakdown = buildCostBreakdown(bankTransactions, sales, "2023-10");

  assert.equal(breakdown.month, "2023-10");
  assert.equal(breakdown.groups.find((g) => g.key === "GEA")?.outflows, 300);
  assert.equal(breakdown.groups.find((g) => g.key === "DEDUCOES_RECEITA")?.outflows, 150);
  assert.equal(breakdown.groups.find((g) => g.key === "COMERCIAL_MKT")?.outflows, 80);
  assert.equal(breakdown.groups.find((g) => g.key === "FINANCEIRAS")?.inflows, 50);
  assert.equal(breakdown.groups.find((g) => g.key === "FINANCEIRAS")?.outflows, 40);
  assert.equal(breakdown.uncategorized.total, 120);
  assert.equal(breakdown.totals.net, 560);
});
