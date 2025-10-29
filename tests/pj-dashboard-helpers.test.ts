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
    bankAccountId: "001",
    accountId: "001",
    fitid: "fit-1",
    sourceHash: "hash-1",
    linkedLegs: [],
    reconciled: false,
    categorizedAs: {
      group: "RECEITA",
      auto: true,
      categoryId: "cat-receita-loja",
      categoryPath: "client.cat-root-receita.cat-receita-loja",
    },
  },
  {
    bankTxId: "oct-receita-2",
    date: "03/10/2023",
    desc: "Recebimento PIX",
    amount: 200,
    bankAccountId: "001",
    accountId: "001",
    fitid: "fit-2",
    sourceHash: "hash-1",
    linkedLegs: [],
    reconciled: false,
    categorizedAs: {
      group: "RECEITA",
      auto: true,
      categoryId: "cat-receita-loja",
      categoryPath: "client.cat-root-receita.cat-receita-loja",
    },
  },
  {
    bankTxId: "oct-deducao",
    date: "04/10/2023",
    desc: "Taxa cartão",
    amount: -150,
    bankAccountId: "001",
    accountId: "001",
    fitid: "fit-3",
    sourceHash: "hash-1",
    linkedLegs: [],
    reconciled: false,
    categorizedAs: {
      group: "DEDUCOES_RECEITA",
      subcategory: "Taxas",
      auto: true,
      categoryId: "cat-ded-taxes",
      categoryPath: "client.cat-root-deducoes.cat-ded-taxes",
    },
  },
  {
    bankTxId: "oct-gea",
    date: "05/10/2023",
    desc: "Aluguel escritório",
    amount: -300,
    bankAccountId: "001",
    accountId: "001",
    fitid: "fit-4",
    sourceHash: "hash-1",
    linkedLegs: [],
    reconciled: false,
    categorizedAs: {
      group: "GEA",
      subcategory: "Aluguel",
      auto: true,
      categoryId: "cat-gea-rent",
      categoryPath: "client.cat-root-gea.cat-gea-rent",
    },
  },
  {
    bankTxId: "oct-uncat",
    date: "06/10/2023",
    desc: "Despesa sem categoria",
    amount: -120,
    bankAccountId: "001",
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
    categorizedAs: {
      group: "COMERCIAL_MKT",
      subcategory: "Ads",
      auto: true,
      categoryId: "cat-com-ads",
      categoryPath: "client.cat-root-com.cat-com-digital.cat-com-ads",
    },
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

const categories = [
  {
    id: "cat-root-receita",
    name: "Receitas",
    path: "client.cat-root-receita",
    level: 1,
    sortOrder: 10,
    parentId: null,
    acceptsPostings: false,
    baseCategoryId: "seed-pj-category-receita",
  },
  {
    id: "cat-receita-loja",
    name: "Receita Loja",
    path: "client.cat-root-receita.cat-receita-loja",
    level: 2,
    sortOrder: 10,
    parentId: "cat-root-receita",
    acceptsPostings: true,
    baseCategoryId: null,
  },
  {
    id: "cat-root-deducoes",
    name: "Deduções",
    path: "client.cat-root-deducoes",
    level: 1,
    sortOrder: 20,
    parentId: null,
    acceptsPostings: false,
    baseCategoryId: "seed-pj-category-deducoes-receita",
  },
  {
    id: "cat-ded-taxes",
    name: "Taxas",
    path: "client.cat-root-deducoes.cat-ded-taxes",
    level: 2,
    sortOrder: 10,
    parentId: "cat-root-deducoes",
    acceptsPostings: true,
    baseCategoryId: null,
  },
  {
    id: "cat-root-gea",
    name: "Despesas Gerais",
    path: "client.cat-root-gea",
    level: 1,
    sortOrder: 30,
    parentId: null,
    acceptsPostings: false,
    baseCategoryId: "seed-pj-category-gea",
  },
  {
    id: "cat-gea-rent",
    name: "Aluguel",
    path: "client.cat-root-gea.cat-gea-rent",
    level: 2,
    sortOrder: 10,
    parentId: "cat-root-gea",
    acceptsPostings: true,
    baseCategoryId: null,
  },
  {
    id: "cat-gea-utilities",
    name: "Energia",
    path: "client.cat-root-gea.cat-gea-utilities",
    level: 2,
    sortOrder: 20,
    parentId: "cat-root-gea",
    acceptsPostings: true,
    baseCategoryId: null,
  },
  {
    id: "cat-root-com",
    name: "Marketing",
    path: "client.cat-root-com",
    level: 1,
    sortOrder: 40,
    parentId: null,
    acceptsPostings: false,
    baseCategoryId: "seed-pj-category-comercial-mkt",
  },
  {
    id: "cat-com-digital",
    name: "Marketing Digital",
    path: "client.cat-root-com.cat-com-digital",
    level: 2,
    sortOrder: 10,
    parentId: "cat-root-com",
    acceptsPostings: false,
    baseCategoryId: null,
  },
  {
    id: "cat-com-ads",
    name: "Ads",
    path: "client.cat-root-com.cat-com-digital.cat-com-ads",
    level: 3,
    sortOrder: 10,
    parentId: "cat-com-digital",
    acceptsPostings: true,
    baseCategoryId: null,
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
  const insights = buildMonthlyInsights(bankTransactions, sales, "2023-10", undefined, categories);

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
  assert.equal(
    insights.highlights.topCustos[0]?.categoryPath,
    "client.cat-root-gea.cat-gea-rent",
  );
  assert.equal(insights.highlights.topCustos[0]?.categoryLabel, "Aluguel");
  assert.equal(insights.highlights.topCustos[0]?.categoryAcceptsPostings, true);
  assert.equal(insights.highlights.despesasNaoCategorizadas.count, 1);
  assert.equal(insights.highlights.despesasNaoCategorizadas.total, 120);

  const lastIndex = insights.charts.faturamentoVsReceita.labels.length - 1;
  assert.equal(insights.charts.faturamentoVsReceita.labels[lastIndex], "2023-10");
  assert.equal(insights.charts.faturamentoVsReceita.faturamento[lastIndex], 2000);
  assert.equal(insights.charts.lucroEMargem.lucroLiquido[lastIndex], 560);
  assert.ok(insights.charts.evolucaoCaixa.labels.length > 0);
});

test("buildCostBreakdown consolidates categories and uncategorized expenses", () => {
  const breakdown = buildCostBreakdown(bankTransactions, sales, "2023-10", categories);

  assert.equal(breakdown.month, "2023-10");
  const geaGroup = breakdown.groups.find((g) => g.key === "GEA");
  const marketingGroup = breakdown.groups.find((g) => g.key === "COMERCIAL_MKT");

  assert.equal(geaGroup?.outflows, 300);
  assert.equal(breakdown.groups.find((g) => g.key === "DEDUCOES_RECEITA")?.outflows, 150);
  assert.equal(marketingGroup?.outflows, 80);
  assert.equal(breakdown.groups.find((g) => g.key === "FINANCEIRAS")?.inflows, 50);
  assert.equal(breakdown.groups.find((g) => g.key === "FINANCEIRAS")?.outflows, 40);
  assert.equal(breakdown.uncategorized.total, 120);
  assert.equal(breakdown.totals.net, 560);

  assert.ok(geaGroup);
  assert.equal(geaGroup?.items.length, 2);
  const rentNode = geaGroup?.items.find((item) => item.categoryId === "cat-gea-rent");
  const energyNode = geaGroup?.items.find((item) => item.categoryId === "cat-gea-utilities");
  assert.equal(rentNode?.outflows, 300);
  assert.equal(energyNode?.outflows, 100);

  assert.ok(marketingGroup);
  const marketingDigital = marketingGroup?.items.find((item) => item.categoryId === "cat-com-digital");
  assert.ok(marketingDigital);
  assert.equal(marketingDigital?.acceptsPostings, false);
  assert.equal(marketingDigital?.directOutflows, 0);
  assert.equal(marketingDigital?.children.length, 1);
  const adsNode = marketingDigital?.children[0];
  assert.equal(adsNode?.categoryId, "cat-com-ads");
  assert.equal(adsNode?.outflows, 80);
  assert.equal(adsNode?.acceptsPostings, true);
});
