import axios, {
  AxiosHeaders,
  type AxiosInstance,
  type AxiosRequestHeaders,
} from "axios";
import {
  Configuration,
  PJBankingApi,
  type AccountsResponse,
  type BankTransaction,
  type BankTransactionListResponse,
  type SummaryResponse,
} from "@financecopilot/pj-banking-sdk";
import { getApiHeaders } from "@/lib/api";
import { logRequestId, type RequestIdentifier } from "@/lib/requestId";
import { mockBankAccounts } from "./mockData";

function headersInitToRecord(headers: HeadersInit): Record<string, string> {
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return { ...(headers as Record<string, string>) };
}

const pjAxios: AxiosInstance = axios.create({ withCredentials: true });

pjAxios.interceptors.request.use((config) => {
  const baseHeaders = AxiosHeaders.from(headersInitToRecord(getApiHeaders()));
  const existingHeaders = AxiosHeaders.from(config.headers ?? {});
  const mergedHeaders = AxiosHeaders.concat(existingHeaders, baseHeaders);

  config.headers = mergedHeaders.toJSON() as AxiosRequestHeaders;
  return config;
});

const pjBankingApi = new PJBankingApi(
  new Configuration({ basePath: "" }),
  undefined,
  pjAxios,
);

function toApiDate(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  if (value.includes("/")) {
    return value;
  }

  const [year, month, day] = value.split("-");
  if (!year || !month || !day) {
    return value;
  }

  return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}`;
}

function toIsoDate(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  if (value.includes("-")) {
    return value;
  }

  const [day, month, year] = value.split("/");
  if (!day || !month || !year) {
    return value;
  }

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function withRequestId<T>(value: T, requestId: RequestIdentifier): T {
  if (!requestId) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => withRequestId(item, requestId)) as unknown as T;
  }

  if (value !== null && typeof value === "object") {
    const base = value as Record<string, unknown>;
    const clonedEntries = Object.fromEntries(
      Object.entries(base).map(([key, nested]) => [key, withRequestId(nested, requestId)]),
    );

    return { ...clonedEntries, requestId } as T;
  }

  return value;
}

export interface WithRequestId {
  requestId?: string | null;
}

export interface PJBankAccount extends WithRequestId {
  id: string;
  clientIds?: string[];
  bankName: string;
  accountNumberMask: string;
  accountType: string;
  currency: string;
  isActive: boolean;
}

export interface PJSummary extends WithRequestId {
  month: string;
  receitas: number;
  despesas: number;
  saldo: number;
  contasReceber: number;
  lucroBruto: number;
  lucroLiquido: number;
  margemLiquida: number;
}

export interface PJTrend extends WithRequestId {
  month: string;
  receitas: number;
  despesas: number;
}

export interface PJRevenueSplitItem extends WithRequestId {
  channel: string;
  amount: number;
}

export interface PJTopCostItem extends WithRequestId {
  category: string;
  item: string;
  total: number;
}

export interface PJSalesKpis extends WithRequestId {
  totalSales: number;
  totalRevenue: number;
  ticketMedio: number;
  topClientes: { customer: string; amount: number }[];
}

export interface PJSaleLeg extends WithRequestId {
  saleLegId: string;
  saleId: string;
  paymentMethod: string;
  grossAmount: number;
  netAmount: number;
  settlementPlan: {
    n: number;
    due: string;
    expected: number;
    receivedTxId?: string;
    receivedAt?: string;
  }[];
  reconciliation: {
    state: string;
  };
}

export interface PJCustomerDetails extends WithRequestId {
  name: string;
  doc?: string;
  email?: string;
  telefone?: string;
}

export interface PJSale extends WithRequestId {
  saleId: string;
  date: string;
  invoiceNumber: string;
  customer: PJCustomerDetails;
  channel: string;
  status: string;
  grossAmount: number;
  netAmount: number;
  legs: Array<{
    method: string;
    installments: number;
    grossAmount: number;
    fees: number;
    netAmount: number;
  }>;
}

export interface PJBankTransaction extends WithRequestId {
  bankTxId: string;
  date: string;
  desc: string;
  amount: number;
  reconciled: boolean;
}

export interface PJBankTransactionsPagination extends WithRequestId {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PJBankTransactionsResponse extends WithRequestId {
  items: PJBankTransaction[];
  pagination: PJBankTransactionsPagination;
}

export interface PJRevenueChannelHighlight extends WithRequestId {
  channel: string;
  total: number;
  count: number;
  percentage: number;
}

export interface PJTopSaleHighlight extends WithRequestId {
  saleId: string;
  date: string;
  amount: number;
  netAmount: number;
  customer: string;
  channel: string;
}

export interface PJTopCostHighlight extends WithRequestId {
  bankTxId: string;
  date: string;
  desc: string;
  amount: number;
  group: string;
  groupLabel: string;
  categoryPath: string | null;
  categoryLabel: string | null;
  categoryLevel: number | null;
  categoryAcceptsPostings: boolean | null;
}

export interface PJUncategorisedExpenseItem extends WithRequestId {
  bankTxId: string;
  date: string;
  desc: string;
  amount: number;
}

export interface PJDashboardMonthlySummary extends WithRequestId {
  faturamento: number;
  receita: number;
  despesas: number;
  saldo: number;
  lucroBruto: number;
  lucroLiquido: number;
  margemLiquida: number;
  ticketMedio: number;
  quantidadeVendas: number;
  deducoesReceita: number;
  despesasGerais: number;
  despesasComercialMarketing: number;
  financeiroIn: number;
  financeiroOut: number;
  outrasIn: number;
  outrasOut: number;
}

export interface PJMonthlyInsightsResponse extends WithRequestId {
  month: string | null;
  availableMonths: string[];
  summary: PJDashboardMonthlySummary;
  charts: {
    faturamentoVsReceita: {
      labels: string[];
      faturamento: number[];
      receita: number[];
    };
    lucroEMargem: {
      labels: string[];
      lucroLiquido: number[];
      margemLiquida: number[];
    };
    evolucaoCaixa: {
      labels: string[];
      saldo: number[];
    };
  };
  highlights: {
    topVendas: PJTopSaleHighlight[];
    topCustos: PJTopCostHighlight[];
    origemReceita: PJRevenueChannelHighlight[];
    despesasNaoCategorizadas: {
      total: number;
      count: number;
      items: PJUncategorisedExpenseItem[];
    };
  };
}

export interface PJCostBreakdownNode extends WithRequestId {
  key: string;
  label: string;
  inflows: number;
  outflows: number;
  net: number;
  categoryId: string | null;
  categoryPath: string;
  level: number;
  path: string[];
  group: string;
  acceptsPostings: boolean;
  sortOrder: number;
  directInflows: number;
  directOutflows: number;
  children: PJCostBreakdownNode[];
}

export interface PJCostBreakdownGroup extends WithRequestId {
  key: string;
  label: string;
  path: string[];
  level: number;
  inflows: number;
  outflows: number;
  net: number;
  group: string;
  acceptsPostings: false;
  items: PJCostBreakdownNode[];
  children: PJCostBreakdownNode[];
}

export interface PJCostBreakdownResponse extends WithRequestId {
  month: string | null;
  availableMonths: string[];
  totals: {
    inflows: number;
    outflows: number;
    net: number;
  };
  groups: PJCostBreakdownGroup[];
  tree: PJCostBreakdownGroup[];
  uncategorized: {
    total: number;
    count: number;
    items: PJUncategorisedExpenseItem[];
  };
}

function cloneNodeWithMetadata(
  node: PJCostBreakdownNode,
  parentPath: string[],
  defaultLevel: number,
): PJCostBreakdownNode {
  const path = node.path?.length ? [...node.path] : [...parentPath, node.key];
  const level = typeof node.level === "number" ? node.level : defaultLevel;
  const normalizedChildren = (node.children ?? [])
    .map((child) => cloneNodeWithMetadata(child, path, level + 1))
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }
      return a.label.localeCompare(b.label);
    });

  return {
    ...node,
    path,
    level,
    children: normalizedChildren,
  };
}

function normalizeGroup(group: PJCostBreakdownGroup): PJCostBreakdownGroup {
  const path = group.path?.length ? [...group.path] : [group.key];
  const normalizedChildren = (group.items ?? group.children ?? [])
    .map((child) => cloneNodeWithMetadata(child, path, 1))
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }
      return a.label.localeCompare(b.label);
    });

  return {
    ...group,
    path,
    level: typeof group.level === "number" ? group.level : 0,
    acceptsPostings: false,
    items: normalizedChildren,
    children: normalizedChildren,
  };
}

export function normalizeCostBreakdownResponse(
  response: PJCostBreakdownResponse,
): PJCostBreakdownResponse {
  const normalizedGroups = response.groups.map((group) => normalizeGroup(group));

  return {
    ...response,
    groups: normalizedGroups,
    tree: response.tree?.length ? response.tree.map((group) => normalizeGroup(group)) : normalizedGroups,
  };
}

export interface PJSummaryParams {
  clientId: string;
  bankAccountId: string;
  from: string;
  to: string;
}

export interface PJTransactionsParams {
  clientId: string;
  bankAccountId: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  sort?: "asc" | "desc";
}

export interface PJPeriodParams {
  clientId: string;
  bankAccountId: string;
  month?: string;
  year?: string;
  from?: string;
  to?: string;
}

export interface PJService {
  listBankAccounts(params: { clientId: string }): Promise<PJBankAccount[]>;
  getSummary(params: PJSummaryParams): Promise<PJSummary>;
  getTrends(params: PJPeriodParams): Promise<{ trends: PJTrend[] }>;
  getRevenueSplit(params: PJPeriodParams): Promise<{ revenueSplit: PJRevenueSplitItem[] }>;
  getTopCosts(params: PJPeriodParams): Promise<{ topCosts: PJTopCostItem[] }>;
  getSalesKpis(params: PJPeriodParams): Promise<PJSalesKpis>;
  getSales(params: PJPeriodParams): Promise<{ sales: PJSale[] }>;
  getSalesLegs(params: { clientId: string; bankAccountId: string }): Promise<{ legs: PJSaleLeg[] }>;
  getBankTransactions(params: { clientId: string; bankAccountId: string }): Promise<PJBankTransactionsResponse>;
  importSalesCsv(params: {
    clientId: string;
    bankAccountId: string;
    file: File;
  }): Promise<{ imported: number; skipped: number }>;
  importBankStatement(params: {
    clientId: string;
    bankAccountId: string;
    file: File;
  }): Promise<{ imported: number }>;
  getMonthlyInsights(params: PJPeriodParams): Promise<PJMonthlyInsightsResponse>;
  getCostBreakdown(params: PJPeriodParams): Promise<PJCostBreakdownResponse>;
}

function mapAccountsResponseToPJAccounts(response: AccountsResponse): PJBankAccount[] {
  return response.accounts.map((account) => ({
    id: account.id,
    bankName: account.bankName,
    accountNumberMask: account.accountNumberMask,
    accountType: account.accountType,
    currency: account.currency,
    isActive: account.isActive,
    clientIds: undefined,
  }));
}

function deriveSummaryMonth(params: PJSummaryParams, summary: SummaryResponse): string {
  const isoFrom = toIsoDate(summary.from) ?? params.from;
  if (isoFrom) {
    return isoFrom.slice(0, 7);
  }

  return new Date().toISOString().slice(0, 7);
}

function mapSummaryResponseToPJSummary(
  summary: SummaryResponse,
  params: PJSummaryParams,
): PJSummary {
  const receitas = summary.totals.totalIn;
  const despesas = summary.totals.totalOut;
  const saldo = summary.totals.balance;
  const lucroBruto = receitas - despesas;
  const lucroLiquido = summary.kpis.projectedBalance ?? saldo;
  const margemLiquida = receitas === 0 ? 0 : (lucroLiquido / receitas) * 100;

  return {
    month: deriveSummaryMonth(params, summary),
    receitas,
    despesas,
    saldo,
    contasReceber: summary.kpis.receivableAmount,
    lucroBruto,
    lucroLiquido,
    margemLiquida,
  };
}

function mapBankTransaction(transaction: BankTransaction): PJBankTransaction {
  return {
    bankTxId: transaction.bankTxId,
    date: toIsoDate(transaction.date) ?? transaction.date,
    desc: transaction.desc,
    amount: transaction.amount,
    reconciled: transaction.reconciled,
  };
}

function mapBankTransactionsResponse(
  response: BankTransactionListResponse,
): PJBankTransactionsResponse {
  return {
    items: response.items.map(mapBankTransaction),
    pagination: response.pagination,
  };
}

export async function getAccounts(params: { clientId: string }): Promise<PJBankAccount[]> {
  const { clientId } = params;
  if (!clientId) {
    throw new Error("clientId is required to list PJ bank accounts");
  }

  const response = await pjBankingApi.apiPjAccountsGet({
    params: { clientId },
  });
  const requestId =
    (response.headers?.["x-request-id"] as string | undefined) ??
    (response.headers?.["X-Request-Id"] as string | undefined) ??
    null;

  logRequestId(
    "pjBanking",
    response.config?.method,
    response.config?.url,
    requestId,
  );

  const accounts = mapAccountsResponseToPJAccounts(response.data);
  return withRequestId(accounts, requestId);
}

export async function getSummary(params: PJSummaryParams): Promise<PJSummary> {
  const { clientId, bankAccountId, from, to } = params;
  const response = await pjBankingApi.apiPjSummaryGet(
    clientId,
    bankAccountId,
    toApiDate(from),
    toApiDate(to),
  );

  const requestId =
    (response.headers?.["x-request-id"] as string | undefined) ??
    (response.headers?.["X-Request-Id"] as string | undefined) ??
    null;

  logRequestId(
    "pjBanking",
    response.config?.method,
    response.config?.url,
    requestId,
  );

  const summary = mapSummaryResponseToPJSummary(response.data, params);
  return withRequestId(summary, requestId);
}

export async function getTransactions(
  params: PJTransactionsParams,
): Promise<PJBankTransactionsResponse> {
  const { clientId, bankAccountId, from, to, page, limit, sort } = params;
  const response = await pjBankingApi.apiPjTransactionsGet(
    clientId,
    bankAccountId,
    toApiDate(from),
    toApiDate(to),
    page,
    limit,
    sort,
  );

  const requestId =
    (response.headers?.["x-request-id"] as string | undefined) ??
    (response.headers?.["X-Request-Id"] as string | undefined) ??
    null;

  logRequestId(
    "pjBanking",
    response.config?.method,
    response.config?.url,
    requestId,
  );

  const transactions = mapBankTransactionsResponse(response.data);
  return withRequestId(transactions, requestId);
}

function createNotImplementedError(method: keyof PJService): Error {
  return new Error(`PJ API endpoint for ${method} is not implemented yet.`);
}

export function createApiPJService(): PJService {
  return {
    listBankAccounts: (params) => getAccounts(params),
    getSummary: (params) => getSummary(params),
    getTrends: async (params) => {
      void params;
      throw createNotImplementedError("getTrends");
    },
    getRevenueSplit: async (params) => {
      void params;
      throw createNotImplementedError("getRevenueSplit");
    },
    getTopCosts: async (params) => {
      void params;
      throw createNotImplementedError("getTopCosts");
    },
    getSalesKpis: async (params) => {
      void params;
      throw createNotImplementedError("getSalesKpis");
    },
    getSales: async (params) => {
      void params;
      throw createNotImplementedError("getSales");
    },
    getSalesLegs: async (params) => {
      void params;
      throw createNotImplementedError("getSalesLegs");
    },
    getBankTransactions: (params) => getTransactions(params),
    importSalesCsv: async (params) => {
      void params;
      throw createNotImplementedError("importSalesCsv");
    },
    importBankStatement: async (params) => {
      void params;
      throw createNotImplementedError("importBankStatement");
    },
    getMonthlyInsights: async (params) => {
      void params;
      throw createNotImplementedError("getMonthlyInsights");
    },
    getCostBreakdown: async (params) => {
      void params;
      throw createNotImplementedError("getCostBreakdown");
    },
  };
}

export const apiPJService = createApiPJService();

const mockSummary: PJSummary = {
  month: "2024-05",
  receitas: 125000,
  despesas: 83000,
  saldo: 42000,
  contasReceber: 18000,
  lucroBruto: 52000,
  lucroLiquido: 32000,
  margemLiquida: 18.5,
};

const mockTrends: PJTrend[] = [
  { month: "Jan", receitas: 95000, despesas: 62000 },
  { month: "Fev", receitas: 102000, despesas: 68000 },
  { month: "Mar", receitas: 98000, despesas: 65000 },
  { month: "Abr", receitas: 118000, despesas: 73000 },
  { month: "Mai", receitas: 125000, despesas: 83000 },
];

const mockRevenueSplit: PJRevenueSplitItem[] = [
  { channel: "E-commerce", amount: 52000 },
  { channel: "Loja Física", amount: 38000 },
  { channel: "Marketplace", amount: 21000 },
  { channel: "B2B", amount: 14000 },
];

const mockTopCosts: PJTopCostItem[] = [
  { category: "Despesas Gerais", item: "Folha de Pagamento", total: 32000 },
  { category: "Marketing", item: "Campanha Digital", total: 12000 },
  { category: "Operacional", item: "Logística", total: 9500 },
  { category: "Tecnologia", item: "Serviços em Nuvem", total: 6800 },
  { category: "Taxas", item: "Tarifas de Cartão", total: 5400 },
];

const mockSalesKpis: PJSalesKpis = {
  totalSales: 1280,
  totalRevenue: 178000,
  ticketMedio: 139,
  topClientes: [
    { customer: "Empresa Alpha", amount: 23000 },
    { customer: "Loja Beta", amount: 18500 },
    { customer: "Distribuidora Gama", amount: 16200 },
  ],
};

const mockSales: PJSale[] = [
  {
    saleId: "sale-001",
    date: "2024-05-14",
    invoiceNumber: "NF-1029",
    customer: {
      name: "Empresa Alpha",
      doc: "12.345.678/0001-99",
      email: "contato@alpha.com",
    },
    channel: "E-commerce",
    status: "captured",
    grossAmount: 2899.9,
    netAmount: 2785.9,
    legs: [
      {
        method: "Cartão Crédito",
        installments: 3,
        grossAmount: 2899.9,
        fees: 114,
        netAmount: 2785.9,
      },
    ],
  },
  {
    saleId: "sale-002",
    date: "2024-05-13",
    invoiceNumber: "NF-1030",
    customer: {
      name: "Loja Beta",
      doc: "98.765.432/0001-11",
      telefone: "+55 11 91234-5678",
    },
    channel: "Marketplace",
    status: "settled",
    grossAmount: 1540,
    netAmount: 1482.4,
    legs: [
      {
        method: "Cartão Crédito",
        installments: 1,
        grossAmount: 1540,
        fees: 57.6,
        netAmount: 1482.4,
      },
    ],
  },
];

const mockLegs: PJSaleLeg[] = [
  {
    saleLegId: "leg-001",
    saleId: "sale-001",
    paymentMethod: "Cartão Crédito",
    grossAmount: 2899.9,
    netAmount: 2785.9,
    settlementPlan: [
      {
        n: 1,
        due: "2024-06-14",
        expected: 928.63,
      },
      {
        n: 2,
        due: "2024-07-14",
        expected: 928.63,
      },
      {
        n: 3,
        due: "2024-08-14",
        expected: 928.63,
      },
    ],
    reconciliation: {
      state: "pending",
    },
  },
  {
    saleLegId: "leg-002",
    saleId: "sale-002",
    paymentMethod: "Cartão Crédito",
    grossAmount: 1540,
    netAmount: 1482.4,
    settlementPlan: [
      {
        n: 1,
        due: "2024-05-16",
        expected: 1482.4,
        receivedTxId: "bank-tx-002",
        receivedAt: "2024-05-16",
      },
    ],
    reconciliation: {
      state: "reconciled",
    },
  },
];

const mockBankTransactions: PJBankTransaction[] = [
  {
    bankTxId: "bank-tx-001",
    date: "2024-05-15",
    desc: "Pagamento fornecedor logística",
    amount: -5200.5,
    reconciled: false,
  },
  {
    bankTxId: "bank-tx-002",
    date: "2024-05-16",
    desc: "Liquidação cartão Loja Beta",
    amount: 1482.4,
    reconciled: true,
  },
  {
    bankTxId: "bank-tx-003",
    date: "2024-05-18",
    desc: "Tarifas bancárias",
    amount: -89.9,
    reconciled: true,
  },
];

const mockInsights: PJMonthlyInsightsResponse = {
  month: "2024-05",
  availableMonths: ["2024-03", "2024-04", "2024-05"],
  summary: {
    faturamento: 210000,
    receita: 178000,
    despesas: 134000,
    saldo: 44000,
    lucroBruto: 86000,
    lucroLiquido: 41000,
    margemLiquida: 19.2,
    ticketMedio: 156,
    quantidadeVendas: 1350,
    deducoesReceita: 22000,
    despesasGerais: 64000,
    despesasComercialMarketing: 29000,
    financeiroIn: 8600,
    financeiroOut: 5400,
    outrasIn: 3200,
    outrasOut: 2700,
  },
  charts: {
    faturamentoVsReceita: {
      labels: ["2024-03", "2024-04", "2024-05"],
      faturamento: [180000, 195000, 210000],
      receita: [150000, 166000, 178000],
    },
    lucroEMargem: {
      labels: ["2024-03", "2024-04", "2024-05"],
      lucroLiquido: [28000, 35000, 41000],
      margemLiquida: [16.2, 17.9, 19.2],
    },
    evolucaoCaixa: {
      labels: ["2024-03", "2024-04", "2024-05"],
      saldo: [28000, 32000, 44000],
    },
  },
  highlights: {
    topVendas: [
      {
        saleId: "sale-001",
        date: "2024-05-14",
        amount: 2899.9,
        netAmount: 2785.9,
        customer: "Empresa Alpha",
        channel: "E-commerce",
      },
      {
        saleId: "sale-003",
        date: "2024-05-08",
        amount: 3180,
        netAmount: 3021.6,
        customer: "Distribuidora Gama",
        channel: "B2B",
      },
    ],
    topCustos: [
      {
        bankTxId: "bank-tx-010",
        date: "2024-05-09",
        desc: "Pagamento folha",
        amount: -32000,
        group: "GEA",
        groupLabel: "Despesas Gerais",
        categoryPath: "demo.gea.folha",
        categoryLabel: "Folha",
        categoryLevel: 2,
        categoryAcceptsPostings: true,
      },
      {
        bankTxId: "bank-tx-012",
        date: "2024-05-12",
        desc: "Campanha marketing",
        amount: -9800,
        group: "COMERCIAL_MKT",
        groupLabel: "Marketing",
        categoryPath: "demo.marketing.digital.ads",
        categoryLabel: "Ads",
        categoryLevel: 3,
        categoryAcceptsPostings: true,
      },
    ],
    origemReceita: [
      { channel: "E-commerce", total: 82000, count: 620, percentage: 46 },
      { channel: "Marketplace", total: 52000, count: 420, percentage: 29 },
      { channel: "B2B", total: 44000, count: 180, percentage: 25 },
    ],
    despesasNaoCategorizadas: {
      total: 4200,
      count: 3,
      items: [
        {
          bankTxId: "bank-tx-020",
          date: "2024-05-11",
          desc: "Despesa a classificar",
          amount: -1200,
        },
        {
          bankTxId: "bank-tx-021",
          date: "2024-05-18",
          desc: "Pagamento fornecedor",
          amount: -1900,
        },
        {
          bankTxId: "bank-tx-022",
          date: "2024-05-21",
          desc: "Serviço recorrente",
          amount: -1100,
        },
      ],
    },
  },
};

const mockCostBreakdownRaw: PJCostBreakdownResponse = {
  month: "2024-05",
  availableMonths: ["2024-03", "2024-04", "2024-05"],
  totals: {
    inflows: 182000,
    outflows: 138000,
    net: 44000,
  },
  groups: [
    {
      key: "RECEITA",
      label: "Receitas",
      path: [],
      level: 0,
      inflows: 182000,
      outflows: 0,
      net: 182000,
      group: "RECEITA",
      acceptsPostings: false,
      items: [
        {
          key: "demo.receita",
          label: "Receita",
          path: [],
          inflows: 182000,
          outflows: 0,
          net: 182000,
          categoryId: "demo.receita",
          categoryPath: "demo.receita",
          level: 1,
          group: "RECEITA",
          acceptsPostings: false,
          sortOrder: 10,
          directInflows: 0,
          directOutflows: 0,
          children: [
            {
              key: "demo.receita.ecommerce",
              label: "E-commerce",
              path: [],
              inflows: 82000,
              outflows: 0,
              net: 82000,
              categoryId: "demo.receita.ecommerce",
              categoryPath: "demo.receita.ecommerce",
              level: 2,
              group: "RECEITA",
              acceptsPostings: true,
              sortOrder: 10,
              directInflows: 82000,
              directOutflows: 0,
              children: [],
            },
            {
              key: "demo.receita.marketplace",
              label: "Marketplace",
              path: [],
              inflows: 52000,
              outflows: 0,
              net: 52000,
              categoryId: "demo.receita.marketplace",
              categoryPath: "demo.receita.marketplace",
              level: 2,
              group: "RECEITA",
              acceptsPostings: true,
              sortOrder: 20,
              directInflows: 52000,
              directOutflows: 0,
              children: [],
            },
            {
              key: "demo.receita.b2b",
              label: "B2B",
              path: [],
              inflows: 48000,
              outflows: 0,
              net: 48000,
              categoryId: "demo.receita.b2b",
              categoryPath: "demo.receita.b2b",
              level: 2,
              group: "RECEITA",
              acceptsPostings: true,
              sortOrder: 30,
              directInflows: 48000,
              directOutflows: 0,
              children: [],
            },
          ],
        },
      ],
      children: [],
    },
    {
      key: "GEA",
      label: "Despesas Gerais",
      path: [],
      level: 0,
      inflows: 0,
      outflows: 64000,
      net: -64000,
      group: "GEA",
      acceptsPostings: false,
      items: [
        {
          key: "demo.gea",
          label: "Despesas Gerais",
          path: [],
          inflows: 0,
          outflows: 64000,
          net: -64000,
          categoryId: "demo.gea",
          categoryPath: "demo.gea",
          level: 1,
          group: "GEA",
          acceptsPostings: false,
          sortOrder: 10,
          directInflows: 0,
          directOutflows: 0,
          children: [
            {
              key: "demo.gea.folha",
              label: "Folha",
              path: [],
              inflows: 0,
              outflows: 32000,
              net: -32000,
              categoryId: "demo.gea.folha",
              categoryPath: "demo.gea.folha",
              level: 2,
              group: "GEA",
              acceptsPostings: true,
              sortOrder: 10,
              directInflows: 0,
              directOutflows: 32000,
              children: [],
            },
            {
              key: "demo.gea.operacional",
              label: "Operacional",
              path: [],
              inflows: 0,
              outflows: 21000,
              net: -21000,
              categoryId: "demo.gea.operacional",
              categoryPath: "demo.gea.operacional",
              level: 2,
              group: "GEA",
              acceptsPostings: true,
              sortOrder: 20,
              directInflows: 0,
              directOutflows: 21000,
              children: [],
            },
            {
              key: "demo.gea.aluguel",
              label: "Aluguel",
              path: [],
              inflows: 0,
              outflows: 11000,
              net: -11000,
              categoryId: "demo.gea.aluguel",
              categoryPath: "demo.gea.aluguel",
              level: 2,
              group: "GEA",
              acceptsPostings: true,
              sortOrder: 30,
              directInflows: 0,
              directOutflows: 11000,
              children: [],
            },
          ],
        },
      ],
      children: [],
    },
    {
      key: "COMERCIAL_MKT",
      label: "Comercial e Marketing",
      path: [],
      level: 0,
      inflows: 0,
      outflows: 29000,
      net: -29000,
      group: "COMERCIAL_MKT",
      acceptsPostings: false,
      items: [
        {
          key: "demo.marketing",
          label: "Marketing",
          path: [],
          inflows: 0,
          outflows: 29000,
          net: -29000,
          categoryId: "demo.marketing",
          categoryPath: "demo.marketing",
          level: 1,
          group: "COMERCIAL_MKT",
          acceptsPostings: false,
          sortOrder: 10,
          directInflows: 0,
          directOutflows: 0,
          children: [
            {
              key: "demo.marketing.digital",
              label: "Digital",
              path: [],
              inflows: 0,
              outflows: 21000,
              net: -21000,
              categoryId: "demo.marketing.digital",
              categoryPath: "demo.marketing.digital",
              level: 2,
              group: "COMERCIAL_MKT",
              acceptsPostings: false,
              sortOrder: 10,
              directInflows: 0,
              directOutflows: 0,
              children: [
                {
                  key: "demo.marketing.digital.ads",
                  label: "Ads",
                  path: [],
                  inflows: 0,
                  outflows: 12000,
                  net: -12000,
                  categoryId: "demo.marketing.digital.ads",
                  categoryPath: "demo.marketing.digital.ads",
                  level: 3,
                  group: "COMERCIAL_MKT",
                  acceptsPostings: true,
                  sortOrder: 10,
                  directInflows: 0,
                  directOutflows: 12000,
                  children: [],
                },
              ],
            },
            {
              key: "demo.marketing.crm",
              label: "CRM",
              path: [],
              inflows: 0,
              outflows: 9000,
              net: -9000,
              categoryId: "demo.marketing.crm",
              categoryPath: "demo.marketing.crm",
              level: 2,
              group: "COMERCIAL_MKT",
              acceptsPostings: true,
              sortOrder: 20,
              directInflows: 0,
              directOutflows: 9000,
              children: [],
            },
            {
              key: "demo.marketing.eventos",
              label: "Eventos",
              path: [],
              inflows: 0,
              outflows: 8000,
              net: -8000,
              categoryId: "demo.marketing.eventos",
              categoryPath: "demo.marketing.eventos",
              level: 2,
              group: "COMERCIAL_MKT",
              acceptsPostings: true,
              sortOrder: 30,
              directInflows: 0,
              directOutflows: 8000,
              children: [],
            },
          ],
        },
      ],
      children: [],
    },
  ],
  tree: [],
  uncategorized: {
    total: 4200,
    count: 3,
    items: mockInsights.highlights.despesasNaoCategorizadas.items,
  },
};

const mockCostBreakdown = normalizeCostBreakdownResponse(mockCostBreakdownRaw);

function resolveAfter<T>(value: T, delay = 120): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), delay);
  });
}

const MOCK_REQUEST_ID = "mock-request-id";

export function createMockPJService(): PJService {
  return {
    async listBankAccounts({ clientId }) {
      if (!clientId) {
        throw new Error("clientId is required to list PJ bank accounts");
      }

      const filtered = mockBankAccounts.filter((account) => {
        if (!account.isActive) {
          return false;
        }
        if (!account.clientIds?.length) {
          return true;
        }
        return account.clientIds.includes(clientId);
      });

      return resolveAfter(withRequestId(filtered, MOCK_REQUEST_ID));
    },
    async getSummary(params) {
      const month = params.from.slice(0, 7);
      return resolveAfter(withRequestId({ ...mockSummary, month }, MOCK_REQUEST_ID));
    },
    async getTrends(params) {
      void params;
      return resolveAfter(withRequestId({ trends: mockTrends }, MOCK_REQUEST_ID));
    },
    async getRevenueSplit(params) {
      void params;
      return resolveAfter(withRequestId({ revenueSplit: mockRevenueSplit }, MOCK_REQUEST_ID));
    },
    async getTopCosts(params) {
      void params;
      return resolveAfter(withRequestId({ topCosts: mockTopCosts }, MOCK_REQUEST_ID));
    },
    async getSalesKpis(params) {
      void params;
      return resolveAfter(withRequestId(mockSalesKpis, MOCK_REQUEST_ID));
    },
    async getSales(params) {
      void params;
      return resolveAfter(withRequestId({ sales: mockSales }, MOCK_REQUEST_ID));
    },
    async getSalesLegs(params) {
      void params;
      return resolveAfter(withRequestId({ legs: mockLegs }, MOCK_REQUEST_ID));
    },
    async getBankTransactions(params) {
      void params;
      return resolveAfter(
        withRequestId(
          {
            items: mockBankTransactions,
            pagination: {
              page: 1,
              limit: 50,
              totalItems: mockBankTransactions.length,
              totalPages: 1,
              hasNextPage: false,
              hasPreviousPage: false,
            },
          },
          MOCK_REQUEST_ID,
        ),
      );
    },
    async importSalesCsv(params) {
      void params;
      return resolveAfter(withRequestId({ imported: 12, skipped: 1 }, MOCK_REQUEST_ID));
    },
    async importBankStatement(params) {
      void params;
      return resolveAfter(withRequestId({ imported: 32 }, MOCK_REQUEST_ID));
    },
    async getMonthlyInsights(params) {
      if (params.month) {
        return resolveAfter(
          withRequestId({ ...mockInsights, month: params.month }, MOCK_REQUEST_ID),
        );
      }
      return resolveAfter(withRequestId(mockInsights, MOCK_REQUEST_ID));
    },
    async getCostBreakdown(params) {
      if (params.month) {
        return resolveAfter(
          withRequestId({ ...mockCostBreakdown, month: params.month }, MOCK_REQUEST_ID),
        );
      }
      return resolveAfter(withRequestId(mockCostBreakdown, MOCK_REQUEST_ID));
    },
  };
}

export const mockPJService = createMockPJService();
