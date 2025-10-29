import { mockBankAccounts } from "./mockData";

export interface PJBankAccount {
  id: string;
  clientIds?: string[];
  bankName: string;
  accountNumberMask: string;
  accountType: string;
  currency: string;
  isActive: boolean;
}

export interface PJSummary {
  month: string;
  receitas: number;
  despesas: number;
  saldo: number;
  contasReceber: number;
  lucroBruto: number;
  lucroLiquido: number;
  margemLiquida: number;
}

export interface PJTrend {
  month: string;
  receitas: number;
  despesas: number;
}

export interface PJRevenueSplitItem {
  channel: string;
  amount: number;
}

export interface PJTopCostItem {
  category: string;
  item: string;
  total: number;
}

export interface PJSalesKpis {
  totalSales: number;
  totalRevenue: number;
  ticketMedio: number;
  topClientes: { customer: string; amount: number }[];
}

export interface PJSaleLeg {
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

export interface PJCustomerDetails {
  name: string;
  doc?: string;
  email?: string;
  telefone?: string;
}

export interface PJSale {
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

export interface PJBankTransaction {
  bankTxId: string;
  date: string;
  desc: string;
  amount: number;
  reconciled: boolean;
}

export interface PJBankTransactionsResponse {
  items: PJBankTransaction[];
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export interface PJRevenueChannelHighlight {
  channel: string;
  total: number;
  count: number;
  percentage: number;
}

export interface PJTopSaleHighlight {
  saleId: string;
  date: string;
  amount: number;
  netAmount: number;
  customer: string;
  channel: string;
}

export interface PJTopCostHighlight {
  bankTxId: string;
  date: string;
  desc: string;
  amount: number;
  group: string;
  groupLabel: string;
}

export interface PJUncategorisedExpenseItem {
  bankTxId: string;
  date: string;
  desc: string;
  amount: number;
}

export interface PJDashboardMonthlySummary {
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

export interface PJMonthlyInsightsResponse {
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

export interface PJCostBreakdownResponse {
  month: string | null;
  availableMonths: string[];
  totals: {
    inflows: number;
    outflows: number;
    net: number;
  };
  groups: {
    key: string;
    label: string;
    inflows: number;
    outflows: number;
    net: number;
    items: {
      key: string;
      label: string;
      inflows: number;
      outflows: number;
      net: number;
    }[];
  }[];
  uncategorized: {
    total: number;
    count: number;
    items: PJUncategorisedExpenseItem[];
  };
}

export interface PJSummaryParams {
  clientId: string;
  bankAccountId: string;
  from: string;
  to: string;
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
  listBankAccounts(params?: { clientId?: string | null }): Promise<PJBankAccount[]>;
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
      },
      {
        bankTxId: "bank-tx-012",
        date: "2024-05-12",
        desc: "Campanha marketing",
        amount: -9800,
        group: "COMERCIAL_MKT",
        groupLabel: "Marketing",
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

const mockCostBreakdown: PJCostBreakdownResponse = {
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
      inflows: 182000,
      outflows: 0,
      net: 182000,
      items: [
        { key: "E_COMMERCE", label: "E-commerce", inflows: 82000, outflows: 0, net: 82000 },
        { key: "MARKETPLACE", label: "Marketplace", inflows: 52000, outflows: 0, net: 52000 },
        { key: "B2B", label: "B2B", inflows: 48000, outflows: 0, net: 48000 },
      ],
    },
    {
      key: "GEA",
      label: "Despesas Gerais",
      inflows: 0,
      outflows: 64000,
      net: -64000,
      items: [
        { key: "FOLHA", label: "Folha", inflows: 0, outflows: 32000, net: -32000 },
        { key: "OPERACIONAL", label: "Operacional", inflows: 0, outflows: 21000, net: -21000 },
        { key: "ALUGUEL", label: "Aluguel", inflows: 0, outflows: 11000, net: -11000 },
      ],
    },
    {
      key: "COMERCIAL_MKT",
      label: "Comercial e Marketing",
      inflows: 0,
      outflows: 29000,
      net: -29000,
      items: [
        { key: "ADS", label: "Ads", inflows: 0, outflows: 12000, net: -12000 },
        { key: "CRM", label: "CRM", inflows: 0, outflows: 9000, net: -9000 },
        { key: "EVENTOS", label: "Eventos", inflows: 0, outflows: 8000, net: -8000 },
      ],
    },
  ],
  uncategorized: {
    total: 4200,
    count: 3,
    items: mockInsights.highlights.despesasNaoCategorizadas.items,
  },
};

function resolveAfter<T>(value: T, delay = 120): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), delay);
  });
}

export function createMockPJService(): PJService {
  return {
    async listBankAccounts(params) {
      const clientId = params?.clientId ?? null;
      if (!clientId) {
        return resolveAfter(mockBankAccounts);
      }
      return resolveAfter(
        mockBankAccounts.filter((account) => {
          if (!account.isActive) {
            return false;
          }
          if (!account.clientIds?.length) {
            return true;
          }
          return account.clientIds.includes(clientId);
        }),
      );
    },
    async getSummary(params) {
      const month = params.from.slice(0, 7);
      return resolveAfter({ ...mockSummary, month });
    },
    async getTrends(params) {
      void params;
      return resolveAfter({ trends: mockTrends });
    },
    async getRevenueSplit(params) {
      void params;
      return resolveAfter({ revenueSplit: mockRevenueSplit });
    },
    async getTopCosts(params) {
      void params;
      return resolveAfter({ topCosts: mockTopCosts });
    },
    async getSalesKpis(params) {
      void params;
      return resolveAfter(mockSalesKpis);
    },
    async getSales(params) {
      void params;
      return resolveAfter({ sales: mockSales });
    },
    async getSalesLegs(params) {
      void params;
      return resolveAfter({ legs: mockLegs });
    },
    async getBankTransactions(params) {
      void params;
      return resolveAfter({
        items: mockBankTransactions,
        pagination: {
          page: 1,
          limit: 50,
          totalItems: mockBankTransactions.length,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });
    },
    async importSalesCsv(params) {
      void params;
      return resolveAfter({ imported: 12, skipped: 1 });
    },
    async importBankStatement(params) {
      void params;
      return resolveAfter({ imported: 32 });
    },
    async getMonthlyInsights(params) {
      if (params.month) {
        return resolveAfter({ ...mockInsights, month: params.month });
      }
      return resolveAfter(mockInsights);
    },
    async getCostBreakdown(params) {
      if (params.month) {
        return resolveAfter({ ...mockCostBreakdown, month: params.month });
      }
      return resolveAfter(mockCostBreakdown);
    },
  };
}

export const mockPJService = createMockPJService();
