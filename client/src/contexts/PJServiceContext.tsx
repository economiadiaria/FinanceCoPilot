import { createContext, useContext, useMemo } from "react";
import { usePJFilters } from "@/contexts/PJFiltersContext";
import type {
  PJBankTransactionsResponse,
  PJCostBreakdownResponse,
  PJDashboardMonthlySummary,
  PJMonthlyInsightsResponse,
  PJSalesKpis,
  PJSummary,
  PJService,
} from "@/services/pj";
import { apiPJService } from "@/services/pj";
import type { PJRevenueSplitItem, PJTopCostItem, PJTrend, PJSale, PJSaleLeg } from "@/services/pj";

interface PJServiceProviderProps {
  service?: PJService;
  children: React.ReactNode;
}

const PJServiceContext = createContext<PJService | null>(null);

const EMPTY_SUMMARY: PJSummary = {
  month: "",
  receitas: 0,
  despesas: 0,
  saldo: 0,
  contasReceber: 0,
  lucroBruto: 0,
  lucroLiquido: 0,
  margemLiquida: 0,
  requestId: null,
};

const EMPTY_DASHBOARD_MONTHLY_SUMMARY: PJDashboardMonthlySummary = {
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
  requestId: null,
};

const EMPTY_SALES_KPIS: PJSalesKpis = {
  totalSales: 0,
  totalRevenue: 0,
  ticketMedio: 0,
  topClientes: [],
  requestId: null,
};

function createEmptyMonthlyInsights(): PJMonthlyInsightsResponse {
  return {
    month: null,
    availableMonths: [],
    summary: { ...EMPTY_DASHBOARD_MONTHLY_SUMMARY },
    charts: {
      faturamentoVsReceita: {
        labels: [],
        faturamento: [],
        receita: [],
      },
      lucroEMargem: {
        labels: [],
        lucroLiquido: [],
        margemLiquida: [],
      },
      evolucaoCaixa: {
        labels: [],
        saldo: [],
      },
    },
    highlights: {
      topVendas: [],
      topCustos: [],
      origemReceita: [],
      despesasNaoCategorizadas: {
        total: 0,
        count: 0,
        items: [],
      },
    },
    requestId: null,
  } as PJMonthlyInsightsResponse;
}

function createEmptyCostBreakdown(): PJCostBreakdownResponse {
  return {
    month: null,
    availableMonths: [],
    totals: {
      inflows: 0,
      outflows: 0,
      net: 0,
    },
    groups: [],
    tree: [],
    uncategorized: {
      total: 0,
      count: 0,
      items: [],
    },
    requestId: null,
  } as PJCostBreakdownResponse;
}

const EMPTY_TRANSACTIONS: PJBankTransactionsResponse = {
  items: [],
  pagination: {
    page: 1,
    limit: 0,
    totalItems: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPreviousPage: false,
    requestId: null,
  },
  requestId: null,
};

const FALLBACK_PJ_SERVICE: PJService = {
  listBankAccounts: async () => [],
  getSummary: async () => ({ ...EMPTY_SUMMARY }),
  getTrends: async () => ({ trends: [] as PJTrend[] }),
  getRevenueSplit: async () => ({ revenueSplit: [] as PJRevenueSplitItem[] }),
  getTopCosts: async () => ({ topCosts: [] as PJTopCostItem[] }),
  getSalesKpis: async () => ({ ...EMPTY_SALES_KPIS }),
  getSales: async () => ({ sales: [] as PJSale[] }),
  getSalesLegs: async () => ({ legs: [] as PJSaleLeg[] }),
  getBankTransactions: async () => ({ ...EMPTY_TRANSACTIONS }),
  importSalesCsv: async () => ({ imported: 0, skipped: 0 }),
  importBankStatement: async () => ({ imported: 0 }),
  getMonthlyInsights: async () => createEmptyMonthlyInsights(),
  getCostBreakdown: async () => createEmptyCostBreakdown(),
};

export function PJServiceProvider({ service, children }: PJServiceProviderProps) {
  const { clientId } = usePJFilters();

  const value = useMemo(() => {
    if (!clientId) {
      return FALLBACK_PJ_SERVICE;
    }

    return service ?? apiPJService;
  }, [clientId, service]);

  return <PJServiceContext.Provider value={value}>{children}</PJServiceContext.Provider>;
}

export function usePJService() {
  const ctx = useContext(PJServiceContext);
  if (!ctx) {
    throw new Error("usePJService must be used within a PJServiceProvider");
  }
  return ctx;
}
