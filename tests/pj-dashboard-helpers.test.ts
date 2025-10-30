import test from "node:test";
import assert from "node:assert/strict";
import { buildCostBreakdown, buildMonthlyInsights } from "../server/pj-dashboard-helpers";
import type { BankTransaction, Sale } from "@shared/schema";

const bankTransactions: BankTransaction[] = [
  {
    bankTxId: "oct-revenue-marketplace",
    date: "02/10/2023",
    desc: "Recebimento marketplace",
    amount: 1500,
    bankAccountId: "001",
    accountId: "001",
    fitid: "fit-1",
    sourceHash: "hash-oct",
    linkedLegs: [],
    reconciled: false,
    categorizedAs: {
      group: "RECEITA",
      auto: true,
      categoryId: "cat-receita-online-marketplace-store",
      categoryPath:
        "client.cat-root-receita.cat-receita-online.cat-receita-online-marketplace.cat-receita-online-marketplace-store",
    },
  },
  {
    bankTxId: "oct-revenue-direct",
    date: "04/10/2023",
    desc: "Recebimento direto",
    amount: 700,
    bankAccountId: "001",
    accountId: "001",
    fitid: "fit-2",
    sourceHash: "hash-oct",
    linkedLegs: [],
    reconciled: false,
    categorizedAs: {
      group: "RECEITA",
      auto: true,
      categoryId: "cat-receita-online-direct",
      categoryPath: "client.cat-root-receita.cat-receita-online.cat-receita-online-direct",
    },
  },
  {
    bankTxId: "oct-deducoes-gateway",
    date: "05/10/2023",
    desc: "Taxa gateway",
    amount: -200,
    bankAccountId: "001",
    accountId: "001",
    fitid: "fit-3",
    sourceHash: "hash-oct",
    linkedLegs: [],
    reconciled: false,
    categorizedAs: {
      group: "DEDUCOES_RECEITA",
      subcategory: "Taxas",
      auto: true,
      categoryId: "cat-ded-gateway-cartoes-taxa",
      categoryPath: "client.cat-root-deducoes.cat-ded-gateway.cat-ded-gateway-cartoes.cat-ded-gateway-cartoes-taxa",
    },
  },
  {
    bankTxId: "oct-gea-rent",
    date: "06/10/2023",
    desc: "Aluguel escritório",
    amount: -400,
    bankAccountId: "001",
    accountId: "001",
    fitid: "fit-4",
    sourceHash: "hash-oct",
    linkedLegs: [],
    reconciled: false,
    categorizedAs: {
      group: "GEA",
      subcategory: "Aluguel",
      auto: true,
      categoryId: "cat-gea-admin-office-rent",
      categoryPath:
        "client.cat-root-gea.cat-gea-admin.cat-gea-admin-office.cat-gea-admin-office-rent",
    },
  },
  {
    bankTxId: "oct-gea-energy",
    date: "07/10/2023",
    desc: "Energia escritório",
    amount: -120,
    bankAccountId: "001",
    accountId: "001",
    fitid: "fit-5",
    sourceHash: "hash-oct",
    linkedLegs: [],
    reconciled: false,
    categorizedAs: {
      group: "GEA",
      subcategory: "Energia",
      auto: true,
      categoryId: "cat-gea-admin-office-energy",
      categoryPath:
        "client.cat-root-gea.cat-gea-admin.cat-gea-admin-office.cat-gea-admin-office-energy",
    },
  },
  {
    bankTxId: "oct-gea-fuel",
    date: "08/10/2023",
    desc: "Combustível frota",
    amount: -90,
    bankAccountId: "001",
    accountId: "001",
    fitid: "fit-6",
    sourceHash: "hash-oct",
    linkedLegs: [],
    reconciled: false,
    categorizedAs: {
      group: "GEA",
      subcategory: "Logística",
      auto: true,
      categoryId: "cat-gea-ops-logistics-fuel",
      categoryPath: "client.cat-root-gea.cat-gea-ops.cat-gea-ops-logistics.cat-gea-ops-logistics-fuel",
    },
  },
  {
    bankTxId: "oct-marketing-ads",
    date: "09/10/2023",
    desc: "Campanha Ads",
    amount: -150,
    bankAccountId: "001",
    accountId: "001",
    fitid: "fit-7",
    sourceHash: "hash-oct",
    linkedLegs: [],
    reconciled: false,
    categorizedAs: {
      group: "COMERCIAL_MKT",
      subcategory: "Ads",
      auto: true,
      categoryId: "cat-com-brand-digital-ads",
      categoryPath: "client.cat-root-com.cat-com-brand.cat-com-brand-digital.cat-com-brand-digital-ads",
    },
  },
  {
    bankTxId: "oct-fin-income",
    date: "10/10/2023",
    desc: "Rendimento aplicação",
    amount: 60,
    bankAccountId: "001",
    accountId: "001",
    fitid: "fit-8",
    sourceHash: "hash-oct",
    linkedLegs: [],
    reconciled: false,
    categorizedAs: {
      group: "FINANCEIRAS",
      subcategory: "Juros",
      auto: true,
      categoryId: "cat-fin-investments-yield",
      categoryPath: "client.cat-root-fin.cat-fin-investments.cat-fin-investments-yield",
    },
  },
  {
    bankTxId: "oct-fin-fee",
    date: "11/10/2023",
    desc: "Tarifa bancária",
    amount: -30,
    bankAccountId: "001",
    accountId: "001",
    fitid: "fit-9",
    sourceHash: "hash-oct",
    linkedLegs: [],
    reconciled: false,
    categorizedAs: {
      group: "FINANCEIRAS",
      subcategory: "Tarifas",
      auto: true,
      categoryId: "cat-fin-expenses-fees",
      categoryPath: "client.cat-root-fin.cat-fin-expenses.cat-fin-expenses-fees",
    },
  },
  {
    bankTxId: "oct-uncategorized",
    date: "12/10/2023",
    desc: "Despesa sem categoria",
    amount: -85,
    bankAccountId: "001",
    accountId: "001",
    fitid: "fit-10",
    sourceHash: "hash-oct",
    linkedLegs: [],
    reconciled: false,
  },
  {
    bankTxId: "sep-revenue",
    date: "15/09/2023",
    desc: "Recebimento setembro",
    amount: 500,
    bankAccountId: "001",
    accountId: "001",
    fitid: "fit-11",
    sourceHash: "hash-sep",
    linkedLegs: [],
    reconciled: false,
    categorizedAs: {
      group: "RECEITA",
      auto: true,
      categoryId: "cat-receita-online-direct",
      categoryPath: "client.cat-root-receita.cat-receita-online.cat-receita-online-direct",
    },
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
    id: "cat-receita-online",
    name: "Receitas Online",
    path: "client.cat-root-receita.cat-receita-online",
    level: 2,
    sortOrder: 10,
    parentId: "cat-root-receita",
    acceptsPostings: false,
    baseCategoryId: null,
  },
  {
    id: "cat-receita-online-marketplace",
    name: "Marketplace",
    path: "client.cat-root-receita.cat-receita-online.cat-receita-online-marketplace",
    level: 3,
    sortOrder: 10,
    parentId: "cat-receita-online",
    acceptsPostings: false,
    baseCategoryId: null,
  },
  {
    id: "cat-receita-online-marketplace-store",
    name: "Loja Marketplace",
    path: "client.cat-root-receita.cat-receita-online.cat-receita-online-marketplace.cat-receita-online-marketplace-store",
    level: 4,
    sortOrder: 10,
    parentId: "cat-receita-online-marketplace",
    acceptsPostings: true,
    baseCategoryId: null,
  },
  {
    id: "cat-receita-online-direct",
    name: "Vendas Diretas Online",
    path: "client.cat-root-receita.cat-receita-online.cat-receita-online-direct",
    level: 3,
    sortOrder: 20,
    parentId: "cat-receita-online",
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
    id: "cat-ded-gateway",
    name: "Gateway",
    path: "client.cat-root-deducoes.cat-ded-gateway",
    level: 2,
    sortOrder: 10,
    parentId: "cat-root-deducoes",
    acceptsPostings: false,
    baseCategoryId: null,
  },
  {
    id: "cat-ded-gateway-cartoes",
    name: "Cartões",
    path: "client.cat-root-deducoes.cat-ded-gateway.cat-ded-gateway-cartoes",
    level: 3,
    sortOrder: 10,
    parentId: "cat-ded-gateway",
    acceptsPostings: false,
    baseCategoryId: null,
  },
  {
    id: "cat-ded-gateway-cartoes-taxa",
    name: "Taxas Cartões",
    path: "client.cat-root-deducoes.cat-ded-gateway.cat-ded-gateway-cartoes.cat-ded-gateway-cartoes-taxa",
    level: 4,
    sortOrder: 10,
    parentId: "cat-ded-gateway-cartoes",
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
    id: "cat-gea-admin",
    name: "Administrativo",
    path: "client.cat-root-gea.cat-gea-admin",
    level: 2,
    sortOrder: 10,
    parentId: "cat-root-gea",
    acceptsPostings: false,
    baseCategoryId: null,
  },
  {
    id: "cat-gea-admin-office",
    name: "Escritório",
    path: "client.cat-root-gea.cat-gea-admin.cat-gea-admin-office",
    level: 3,
    sortOrder: 10,
    parentId: "cat-gea-admin",
    acceptsPostings: false,
    baseCategoryId: null,
  },
  {
    id: "cat-gea-admin-office-rent",
    name: "Aluguel Escritório",
    path: "client.cat-root-gea.cat-gea-admin.cat-gea-admin-office.cat-gea-admin-office-rent",
    level: 4,
    sortOrder: 10,
    parentId: "cat-gea-admin-office",
    acceptsPostings: true,
    baseCategoryId: null,
  },
  {
    id: "cat-gea-admin-office-energy",
    name: "Energia Escritório",
    path: "client.cat-root-gea.cat-gea-admin.cat-gea-admin-office.cat-gea-admin-office-energy",
    level: 4,
    sortOrder: 20,
    parentId: "cat-gea-admin-office",
    acceptsPostings: true,
    baseCategoryId: null,
  },
  {
    id: "cat-gea-ops",
    name: "Operações",
    path: "client.cat-root-gea.cat-gea-ops",
    level: 2,
    sortOrder: 20,
    parentId: "cat-root-gea",
    acceptsPostings: false,
    baseCategoryId: null,
  },
  {
    id: "cat-gea-ops-logistics",
    name: "Logística",
    path: "client.cat-root-gea.cat-gea-ops.cat-gea-ops-logistics",
    level: 3,
    sortOrder: 10,
    parentId: "cat-gea-ops",
    acceptsPostings: false,
    baseCategoryId: null,
  },
  {
    id: "cat-gea-ops-logistics-fuel",
    name: "Combustível Frota",
    path: "client.cat-root-gea.cat-gea-ops.cat-gea-ops-logistics.cat-gea-ops-logistics-fuel",
    level: 4,
    sortOrder: 10,
    parentId: "cat-gea-ops-logistics",
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
    id: "cat-com-brand",
    name: "Brand",
    path: "client.cat-root-com.cat-com-brand",
    level: 2,
    sortOrder: 10,
    parentId: "cat-root-com",
    acceptsPostings: false,
    baseCategoryId: null,
  },
  {
    id: "cat-com-brand-digital",
    name: "Marketing Digital",
    path: "client.cat-root-com.cat-com-brand.cat-com-brand-digital",
    level: 3,
    sortOrder: 10,
    parentId: "cat-com-brand",
    acceptsPostings: false,
    baseCategoryId: null,
  },
  {
    id: "cat-com-brand-digital-ads",
    name: "Ads",
    path: "client.cat-root-com.cat-com-brand.cat-com-brand-digital.cat-com-brand-digital-ads",
    level: 4,
    sortOrder: 10,
    parentId: "cat-com-brand-digital",
    acceptsPostings: true,
    baseCategoryId: null,
  },
  {
    id: "cat-root-fin",
    name: "Financeiro",
    path: "client.cat-root-fin",
    level: 1,
    sortOrder: 50,
    parentId: null,
    acceptsPostings: false,
    baseCategoryId: "seed-pj-category-financeiras",
  },
  {
    id: "cat-fin-investments",
    name: "Investimentos",
    path: "client.cat-root-fin.cat-fin-investments",
    level: 2,
    sortOrder: 10,
    parentId: "cat-root-fin",
    acceptsPostings: false,
    baseCategoryId: null,
  },
  {
    id: "cat-fin-investments-yield",
    name: "Rendimentos",
    path: "client.cat-root-fin.cat-fin-investments.cat-fin-investments-yield",
    level: 3,
    sortOrder: 10,
    parentId: "cat-fin-investments",
    acceptsPostings: true,
    baseCategoryId: null,
  },
  {
    id: "cat-fin-expenses",
    name: "Despesas Financeiras",
    path: "client.cat-root-fin.cat-fin-expenses",
    level: 2,
    sortOrder: 20,
    parentId: "cat-root-fin",
    acceptsPostings: false,
    baseCategoryId: null,
  },
  {
    id: "cat-fin-expenses-fees",
    name: "Tarifas Bancárias",
    path: "client.cat-root-fin.cat-fin-expenses.cat-fin-expenses-fees",
    level: 3,
    sortOrder: 10,
    parentId: "cat-fin-expenses",
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
    grossAmount: 1800,
    netAmount: 1700,
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
    grossAmount: 600,
    netAmount: 580,
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
    grossAmount: 900,
    netAmount: 880,
    comment: undefined,
    legs: [],
  },
];

const invalidAggregatorPosting: BankTransaction = {
  bankTxId: "oct-invalid-admin",
  date: "13/10/2023",
  desc: "Lançamento em nó agregador",
  amount: -250,
  bankAccountId: "001",
  accountId: "001",
  fitid: "fit-12",
  sourceHash: "hash-oct",
  linkedLegs: [],
  reconciled: false,
  categorizedAs: {
    group: "GEA",
    auto: false,
    categoryId: "cat-gea-admin",
    categoryPath: "client.cat-root-gea.cat-gea-admin",
  },
};

test("buildMonthlyInsights aggregates PJ metrics with imported data", () => {
  const insights = buildMonthlyInsights(bankTransactions, sales, "2023-10", undefined, categories);

  assert.equal(insights.month, "2023-10");
  assert.deepEqual(insights.availableMonths, ["2023-10", "2023-09"]);

  assert.equal(insights.summary.faturamento, 2400);
  assert.equal(insights.summary.receita, 2200);
  assert.equal(insights.summary.despesas, 1075);
  assert.equal(insights.summary.lucroBruto, 2000);
  assert.equal(insights.summary.lucroLiquido, 1185);
  assert.equal(insights.summary.saldo, 1185);
  assert.equal(insights.summary.deducoesReceita, 200);
  assert.equal(insights.summary.despesasGerais, 610);
  assert.equal(insights.summary.despesasComercialMarketing, 150);
  assert.equal(insights.summary.financeiroIn, 60);
  assert.equal(insights.summary.financeiroOut, 30);
  assert.equal(insights.summary.quantidadeVendas, 2);
  assert.equal(insights.summary.ticketMedio, 1200);

  assert.equal(insights.highlights.topVendas.length, 2);
  assert.equal(insights.highlights.topVendas[0]?.amount, 1800);
  assert.equal(insights.highlights.topCustos[0]?.amount, 400);
  assert.equal(
    insights.highlights.topCustos[0]?.categoryPath,
    "client.cat-root-gea.cat-gea-admin.cat-gea-admin-office.cat-gea-admin-office-rent",
  );
  assert.equal(insights.highlights.topCustos[0]?.categoryLabel, "Aluguel Escritório");
  assert.equal(insights.highlights.topCustos[0]?.categoryAcceptsPostings, true);
  assert.equal(insights.highlights.despesasNaoCategorizadas.count, 1);
  assert.equal(insights.highlights.despesasNaoCategorizadas.total, 85);

  const lastIndex = insights.charts.faturamentoVsReceita.labels.length - 1;
  assert.equal(insights.charts.faturamentoVsReceita.labels[lastIndex], "2023-10");
  assert.equal(insights.charts.faturamentoVsReceita.faturamento[lastIndex], 2400);
  assert.equal(insights.charts.lucroEMargem.lucroLiquido[lastIndex], 1185);
  assert.ok(insights.charts.evolucaoCaixa.labels.length > 0);
});

test("buildCostBreakdown consolida totais em cada nível da árvore", () => {
  const breakdown = buildCostBreakdown(bankTransactions, sales, "2023-10", categories);

  assert.equal(breakdown.month, "2023-10");
  const geaGroup = breakdown.groups.find((g) => g.key === "GEA");
  const marketingGroup = breakdown.groups.find((g) => g.key === "COMERCIAL_MKT");

  assert.equal(geaGroup?.outflows, 610);
  assert.equal(breakdown.groups.find((g) => g.key === "DEDUCOES_RECEITA")?.outflows, 200);
  assert.equal(marketingGroup?.outflows, 150);
  assert.equal(breakdown.groups.find((g) => g.key === "FINANCEIRAS")?.inflows, 60);
  assert.equal(breakdown.groups.find((g) => g.key === "FINANCEIRAS")?.outflows, 30);
  assert.equal(breakdown.uncategorized.total, 85);
  assert.equal(breakdown.totals.net, 1185);

  assert.ok(geaGroup);
  const geaRoot = geaGroup!.children.find((node) => node.categoryId === "cat-root-gea");
  assert.ok(geaRoot);
  assert.equal(geaRoot!.outflows, 610);

  const geaAdmin = geaRoot!.children.find((node) => node.categoryId === "cat-gea-admin");
  assert.ok(geaAdmin);
  assert.equal(geaAdmin!.outflows, 520);
  assert.equal(geaAdmin!.directOutflows, 0);

  const geaOffice = geaAdmin!.children.find((node) => node.categoryId === "cat-gea-admin-office");
  assert.ok(geaOffice);
  assert.equal(geaOffice!.outflows, 520);
  assert.equal(geaOffice!.directOutflows, 0);

  const rentLeaf = geaOffice!.children.find((node) => node.categoryId === "cat-gea-admin-office-rent");
  assert.ok(rentLeaf);
  assert.equal(rentLeaf!.outflows, 400);
  assert.equal(rentLeaf!.acceptsPostings, true);
  assert.equal(rentLeaf!.directOutflows, 400);

  const energyLeaf = geaOffice!.children.find((node) => node.categoryId === "cat-gea-admin-office-energy");
  assert.ok(energyLeaf);
  assert.equal(energyLeaf!.outflows, 120);
  assert.equal(energyLeaf!.acceptsPostings, true);
  assert.equal(energyLeaf!.directOutflows, 120);

  const geaOps = geaRoot!.children.find((node) => node.categoryId === "cat-gea-ops");
  assert.ok(geaOps);
  assert.equal(geaOps!.outflows, 90);
  assert.equal(geaOps!.directOutflows, 0);

  const logisticsNode = geaOps!.children.find((node) => node.categoryId === "cat-gea-ops-logistics");
  assert.ok(logisticsNode);
  assert.equal(logisticsNode!.outflows, 90);
  assert.equal(logisticsNode!.directOutflows, 0);

  const fuelLeaf = logisticsNode!.children.find((node) => node.categoryId === "cat-gea-ops-logistics-fuel");
  assert.ok(fuelLeaf);
  assert.equal(fuelLeaf!.outflows, 90);
  assert.equal(fuelLeaf!.acceptsPostings, true);
  assert.equal(fuelLeaf!.directOutflows, 90);

  assert.ok(marketingGroup);
  const marketingRoot = marketingGroup!.children.find((node) => node.categoryId === "cat-root-com");
  assert.ok(marketingRoot);
  assert.equal(marketingRoot!.outflows, 150);

  const marketingBrand = marketingRoot!.children.find((node) => node.categoryId === "cat-com-brand");
  assert.ok(marketingBrand);
  assert.equal(marketingBrand!.outflows, 150);

  const marketingDigital = marketingBrand!.children.find((node) => node.categoryId === "cat-com-brand-digital");
  assert.ok(marketingDigital);
  assert.equal(marketingDigital!.outflows, 150);
  assert.equal(marketingDigital!.acceptsPostings, false);
  assert.equal(marketingDigital!.directOutflows, 0);

  const adsLeaf = marketingDigital!.children.find((node) => node.categoryId === "cat-com-brand-digital-ads");
  assert.ok(adsLeaf);
  assert.equal(adsLeaf!.outflows, 150);
  assert.equal(adsLeaf!.acceptsPostings, true);
  assert.equal(adsLeaf!.directOutflows, 150);
});

test("buildCostBreakdown rejeita lançamentos em nós que não aceitam postings", () => {
  const withInvalidPosting = [
    ...bankTransactions.filter((tx) => tx.bankTxId !== invalidAggregatorPosting.bankTxId),
    invalidAggregatorPosting,
  ];

  const breakdown = buildCostBreakdown(withInvalidPosting, sales, "2023-10", categories);
  const geaGroup = breakdown.groups.find((g) => g.key === "GEA");
  assert.ok(geaGroup);

  assert.equal(geaGroup!.outflows, 860);
  const childrenTotal = geaGroup!.children.reduce((sum, child) => sum + child.outflows, 0);
  assert.equal(childrenTotal, 610);
  assert.equal(geaGroup!.outflows - childrenTotal, 250);

  const geaRoot = geaGroup!.children.find((node) => node.categoryId === "cat-root-gea");
  assert.ok(geaRoot);
  const geaAdmin = geaRoot!.children.find((node) => node.categoryId === "cat-gea-admin");
  assert.ok(geaAdmin);

  assert.equal(geaAdmin!.outflows, 520);
  assert.equal(geaAdmin!.directOutflows, 0);

  const adminItem = geaGroup!.items.find((item) => item.categoryId === "cat-gea-admin");
  assert.ok(adminItem);
  assert.equal(adminItem!.outflows, 520);
  assert.equal(adminItem!.directOutflows, 0);
});
