import { beforeEach, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import React, { useEffect, useRef } from "react";
import { JSDOM } from "jsdom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  PJFiltersProvider,
  usePJFilters,
  type PJDateRange,
  type PJBankAccountOption,
} from "../client/src/contexts/PJFiltersContext";
import { PJServiceProvider } from "../client/src/contexts/PJServiceContext";
import ResumoPJ from "../client/src/pages/pj/resumo";
import TransacoesPJ from "../client/src/pages/pj/transacoes";
import type {
  PJService,
  PJBankAccount,
  PJSummary,
  PJSummaryParams,
  PJPeriodParams,
  PJTransactionsParams,
  PJBankTransactionsResponse,
  PJTrend,
  PJRevenueSplitItem,
  PJTopCostItem,
  PJSalesKpis,
  PJSale,
  PJSaleLeg,
  PJMonthlyInsightsResponse,
  PJCostBreakdownResponse,
} from "../client/src/services/pj";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
const { window } = dom;

function copyWindowProperties(target: typeof globalThis, source: Window & typeof globalThis) {
  const descriptors = Object.getOwnPropertyDescriptors(source);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (key in target) {
      continue;
    }
    Object.defineProperty(target, key, descriptor as PropertyDescriptor);
  }
}

Object.assign(globalThis, {
  window: window as unknown as typeof globalThis.window,
  document: window.document,
});

Object.defineProperty(globalThis, "navigator", {
  value: window.navigator,
  configurable: true,
});
copyWindowProperties(globalThis, window as unknown as Window & typeof globalThis);
Object.defineProperty(globalThis, "React", { value: React, configurable: true });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testingLibrary = await import("@testing-library/react");
const { render, screen, waitFor, cleanup, act } = testingLibrary;

type FilterControls = {
  setClientId: (value: string | null) => void;
  setSelectedAccountId: (value: string | null) => void;
  setDateRange: (value: PJDateRange) => void;
  allAccountsOption: PJBankAccountOption;
};

function FiltersController({ onReady }: { onReady: (controls: FilterControls) => void }) {
  const { setClientId, setSelectedAccountId, setDateRange, allAccountsOption } = usePJFilters();
  const hasEmitted = useRef(false);

  useEffect(() => {
    if (hasEmitted.current) {
      return;
    }
    hasEmitted.current = true;
    onReady({ setClientId, setSelectedAccountId, setDateRange, allAccountsOption });
  }, [allAccountsOption, onReady, setClientId, setSelectedAccountId, setDateRange]);

  return null;
}

class MockPJService implements PJService {
  public readonly accounts: PJBankAccount[] = [
    {
      id: "acc-1",
      bankName: "Banco Alpha",
      accountNumberMask: "****1234",
      accountType: "corrente",
      currency: "BRL",
      isActive: true,
      clientIds: undefined,
    },
    {
      id: "acc-2",
      bankName: "Banco Beta",
      accountNumberMask: "****5678",
      accountType: "corrente",
      currency: "BRL",
      isActive: true,
      clientIds: undefined,
    },
  ];

  public readonly summaryCalls: PJSummaryParams[] = [];
  public readonly transactionCalls: PJTransactionsParams[] = [];
  public readonly listCalls: Array<{ clientId: string }> = [];

  private readonly summaryBase = new Map<string, number>([
    ["acc-1", 1000],
    ["acc-2", 2000],
  ]);

  async listBankAccounts(params: { clientId: string }): Promise<PJBankAccount[]> {
    this.listCalls.push(params);
    return this.accounts;
  }

  async getSummary(params: PJSummaryParams): Promise<PJSummary> {
    this.summaryCalls.push(params);
    const monthIndex = params.from ? new Date(params.from).getMonth() + 1 : 1;
    const base = this.summaryBase.get(params.bankAccountId) ?? 0;
    const receitas = base * monthIndex;
    const despesas = Math.round(receitas * 0.4);
    const saldo = receitas - despesas;
    const lucroLiquido = saldo - 100;
    const margemLiquida = receitas > 0 ? Number(((lucroLiquido / receitas) * 100).toFixed(1)) : 0;

    return {
      month: params.from?.slice(0, 7) ?? "2024-01",
      receitas,
      despesas,
      saldo,
      contasReceber: Math.round(receitas * 0.5),
      lucroBruto: saldo,
      lucroLiquido,
      margemLiquida,
      requestId: `summary-${params.bankAccountId}-${monthIndex}`,
    };
  }

  async getTrends(_params: PJPeriodParams): Promise<{ trends: PJTrend[] }> {
    return { trends: [] };
  }

  async getRevenueSplit(_params: PJPeriodParams): Promise<{ revenueSplit: PJRevenueSplitItem[] }> {
    return { revenueSplit: [] };
  }

  async getTopCosts(_params: PJPeriodParams): Promise<{ topCosts: PJTopCostItem[] }> {
    return { topCosts: [] };
  }

  async getSalesKpis(_params: PJPeriodParams): Promise<PJSalesKpis> {
    return {
      totalSales: 0,
      totalRevenue: 0,
      ticketMedio: 0,
      topClientes: [],
      requestId: null,
    };
  }

  async getSales(_params: PJPeriodParams): Promise<{ sales: PJSale[] }> {
    return { sales: [] };
  }

  async getSalesLegs(_params: { clientId: string; bankAccountId: string }): Promise<{ legs: PJSaleLeg[] }> {
    return { legs: [] };
  }

  async getBankTransactions(params: PJTransactionsParams): Promise<PJBankTransactionsResponse> {
    this.transactionCalls.push(params);
    const monthIndex = params.from ? new Date(params.from).getMonth() + 1 : 1;
    const base = this.summaryBase.get(params.bankAccountId) ?? 0;
    const amount = base * monthIndex * 0.1;
    const fromLabel = params.from ?? "2024-01-01";

    return {
      items: [
        {
          bankTxId: `${params.bankAccountId}-${fromLabel}`,
          date: fromLabel,
          desc: `Movimento ${params.bankAccountId} ${fromLabel}`,
          amount,
          reconciled: false,
          requestId: null,
        },
      ],
      pagination: {
        page: 1,
        limit: 50,
        totalItems: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
        requestId: null,
      },
      requestId: `txn-${params.bankAccountId}-${monthIndex}`,
    };
  }

  async importSalesCsv(_params: {
    clientId: string;
    bankAccountId: string;
    file: File;
  }): Promise<{ imported: number; skipped: number }> {
    return { imported: 0, skipped: 0 };
  }

  async importBankStatement(_params: {
    clientId: string;
    bankAccountId: string;
    file: File;
  }): Promise<{ imported: number }> {
    return { imported: 0 };
  }

  async getMonthlyInsights(_params: PJPeriodParams): Promise<PJMonthlyInsightsResponse> {
    return {
      month: null,
      availableMonths: [],
      summary: {
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
      },
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
      requestId: null,
    } as PJMonthlyInsightsResponse;
  }

  async getCostBreakdown(_params: PJPeriodParams): Promise<PJCostBreakdownResponse> {
    return {
      month: null,
      availableMonths: [],
      totals: { inflows: 0, outflows: 0, net: 0 },
      groups: [],
      tree: [],
      uncategorized: { total: 0, count: 0, items: [] },
      requestId: null,
    } as PJCostBreakdownResponse;
  }
}

function formatReceitas(value: number): string {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

function renderWithProviders(service: MockPJService, onReady: (controls: FilterControls) => void) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const tree = React.createElement(
    QueryClientProvider,
    { client: queryClient },
    React.createElement(
      PJFiltersProvider,
      null,
      React.createElement(
        PJServiceProvider,
        { service },
        React.createElement(
          React.Fragment,
          null,
          React.createElement(FiltersController, { onReady }),
          React.createElement(
            "div",
            null,
            React.createElement(ResumoPJ, { clientType: "PJ" }),
            React.createElement(TransacoesPJ, { clientType: "PJ" }),
          ),
        ),
      ),
    ),
  );

  return render(tree);
}

describe("PJ filters account and date range flow", () => {
  let service: MockPJService;
  let controls: FilterControls | null;

  beforeEach(() => {
    service = new MockPJService();
    controls = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("updates summary and transactions when switching accounts and date ranges", async () => {
    renderWithProviders(service, (value) => {
      controls = value;
    });

    await waitFor(() => {
      assert.ok(controls);
    });

    await act(async () => {
      controls!.setClientId("client-1");
    });

    await waitFor(() => {
      assert.equal(service.listCalls.length, 1);
    });

    await act(async () => {
      controls!.setSelectedAccountId(service.accounts[0].id);
    });

    await waitFor(() => {
      const lastSummary = service.summaryCalls.at(-1);
      assert.ok(lastSummary);
      assert.equal(lastSummary.bankAccountId, service.accounts[0].id);
    });

    await waitFor(() => {
      const lastTxn = service.transactionCalls.at(-1);
      assert.ok(lastTxn);
      assert.equal(lastTxn.bankAccountId, service.accounts[0].id);
    });

    await waitFor(() => {
      const labels = screen.getAllByText(
        `${service.accounts[0].bankName} • ${service.accounts[0].accountNumberMask}`,
      );
      assert.equal(labels.length, 2);
    });

    await waitFor(() => {
      const metric = screen.getByTestId("metric-receitas-value");
      assert.equal(metric.textContent, formatReceitas(1000));
    });

    const summaryCallsBeforeAll = service.summaryCalls.length;
    const txnCallsBeforeAll = service.transactionCalls.length;

    await act(async () => {
      controls!.setSelectedAccountId(controls!.allAccountsOption.id);
    });

    await waitFor(() => {
      const newCalls = service.summaryCalls.slice(summaryCallsBeforeAll);
      const accountIds = new Set(newCalls.map((call) => call.bankAccountId));
      assert.deepEqual(accountIds, new Set(service.accounts.map((account) => account.id)));
    });

    await waitFor(() => {
      const newCalls = service.transactionCalls.slice(txnCallsBeforeAll);
      const accountIds = new Set(newCalls.map((call) => call.bankAccountId));
      assert.deepEqual(accountIds, new Set(service.accounts.map((account) => account.id)));
    });

    await waitFor(() => {
      const labels = screen.getAllByText("Todas as Contas");
      assert.equal(labels.length, 2);
    });

    await waitFor(() => {
      assert.ok(screen.getByText(/Movimento acc-1/));
      assert.ok(screen.getByText(/Movimento acc-2/));
    });

    await act(async () => {
      controls!.setSelectedAccountId(service.accounts[0].id);
    });

    await waitFor(() => {
      const lastSummary = service.summaryCalls.at(-1);
      assert.ok(lastSummary);
      assert.equal(lastSummary.bankAccountId, service.accounts[0].id);
    });

    const newRange: PJDateRange = {
      from: new Date("2024-03-01T00:00:00Z"),
      to: new Date("2024-03-31T00:00:00Z"),
    };

    await act(async () => {
      controls!.setDateRange(newRange);
    });

    await waitFor(() => {
      const lastSummary = service.summaryCalls.at(-1);
      assert.ok(lastSummary);
      assert.equal(lastSummary.from, "2024-03-01");
      assert.equal(lastSummary.to, "2024-03-31");
    });

    await waitFor(() => {
      const lastTxn = service.transactionCalls.at(-1);
      assert.ok(lastTxn);
      assert.equal(lastTxn.from, "2024-03-01");
      assert.equal(lastTxn.to, "2024-03-31");
    });

    await waitFor(() => {
      const metric = screen.getByTestId("metric-receitas-value");
      assert.equal(metric.textContent, formatReceitas(3000));
    });

    await waitFor(() => {
      assert.ok(screen.getByText("Movimento acc-1 2024-03-01"));
    });
  });
});
