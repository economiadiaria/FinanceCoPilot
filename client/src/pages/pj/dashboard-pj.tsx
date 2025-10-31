import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/metric-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { usePJService } from "@/contexts/PJServiceContext";
import { usePJFilters } from "@/contexts/PJFiltersContext";
import { usePJBankAccounts } from "@/hooks/usePJBankAccounts";
import { formatRangeLabel, toApiDateRange } from "@/lib/date-range";
import { useRequestIdToasts } from "@/hooks/useRequestIdToasts";
import { extractRequestId, formatRequestId } from "@/lib/requestId";
import { TrendingUp, DollarSign, CreditCard } from "lucide-react";
import type { PJSummary, PJSalesKpis } from "@/services/pj";
import { Badge } from "@/components/ui/badge";

interface DashboardPJProps {
  clientType: string | null;
}

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

function getRequestId(value: unknown): string | null {
  return extractRequestId(value);
}

function aggregateSummary(responses: PJSummary[]): PJSummary | null {
  if (!responses.length) {
    return null;
  }

  const totals = responses.reduce(
    (acc, summary) => {
      acc.receitas += summary.receitas;
      acc.despesas += summary.despesas;
      acc.saldo += summary.saldo;
      acc.lucroLiquido += summary.lucroLiquido;
      return acc;
    },
    {
      receitas: 0,
      despesas: 0,
      saldo: 0,
      lucroLiquido: 0,
    },
  );

  return {
    month: "",
    receitas: totals.receitas,
    despesas: totals.despesas,
    saldo: totals.saldo,
    contasReceber: 0,
    lucroBruto: 0,
    lucroLiquido: totals.lucroLiquido,
    margemLiquida: totals.receitas > 0 ? Number(((totals.lucroLiquido / totals.receitas) * 100).toFixed(1)) : 0,
    requestId: null,
  };
}

function aggregateSalesKpis(responses: PJSalesKpis[]): PJSalesKpis | null {
  if (!responses.length) {
    return null;
  }

  const totals = responses.reduce(
    (acc, kpi) => {
      acc.totalSales += kpi.totalSales;
      acc.totalRevenue += kpi.totalRevenue;
      acc.topClientes.push(...kpi.topClientes);
      return acc;
    },
    {
      totalSales: 0,
      totalRevenue: 0,
      topClientes: [] as PJSalesKpis["topClientes"],
    },
  );

  const ticketMedio = totals.totalSales > 0 ? totals.totalRevenue / totals.totalSales : 0;

  const mergedTopClients = totals.topClientes.reduce(
    (map, client) => {
      const current = map.get(client.customer) ?? { customer: client.customer, amount: 0 };
      current.amount += client.amount;
      map.set(client.customer, current);
      return map;
    },
    new Map<string, { customer: string; amount: number }>(),
  );

  return {
    totalSales: totals.totalSales,
    totalRevenue: totals.totalRevenue,
    ticketMedio,
    topClientes: Array.from(mergedTopClients.values())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5),
    requestId: null,
  };
}

export default function DashboardPJ({ clientType }: DashboardPJProps) {
  const pjService = usePJService();
  const { clientId, selectedAccountId, dateRange, allAccountsOption } = usePJFilters();
  const isPJClient = clientType === "PJ" || clientType === "BOTH";

  const {
    options: bankAccountOptions,
    accounts: availableAccounts,
    isLoading: isLoadingAccounts,
  } = usePJBankAccounts({
    clientId,
    enabled: isPJClient,
  });

  const selectedAccount = useMemo(
    () => bankAccountOptions.find((account) => account.id === selectedAccountId) ?? null,
    [bankAccountOptions, selectedAccountId],
  );

  const accountLabel = useMemo(() => {
    if (!selectedAccount) {
      return "Selecione uma conta PJ";
    }

    if (selectedAccount.isAggregate) {
      return selectedAccount.bankName;
    }

    return `${selectedAccount.bankName} • ${selectedAccount.accountNumberMask}`;
  }, [selectedAccount]);

  const isAllAccounts = selectedAccountId === allAccountsOption.id;
  const { from, to } = useMemo(() => toApiDateRange(dateRange), [dateRange]);
  const rangeLabel = useMemo(() => formatRangeLabel(dateRange), [dateRange]);
  const accountIdsKey = useMemo(() => availableAccounts.map((account) => account.id).sort().join("|"), [
    availableAccounts,
  ]);

  const canQuery = Boolean(
    clientId &&
      from &&
      to &&
      isPJClient &&
      (isAllAccounts ? availableAccounts.length > 0 : selectedAccountId),
  );

  const summaryQuery = useQuery({
    queryKey: [
      "pj:dashboard:summary",
      {
        clientId,
        selectedAccountId,
        from,
        to,
        accountIdsKey,
        isAllAccounts,
      },
    ],
    enabled: canQuery,
    queryFn: async () => {
      if (!clientId || !from || !to) {
        return { summary: null as PJSummary | null, requestIds: [] as string[] };
      }

      if (isAllAccounts) {
        const responses = await Promise.all(
          availableAccounts.map((account) =>
            pjService.getSummary({
              clientId,
              bankAccountId: account.id,
              from,
              to,
            }),
          ),
        );

        const summary = aggregateSummary(responses);
        const requestIds = responses
          .map((response) => getRequestId(response))
          .filter((id): id is string => Boolean(id));

        return { summary, requestIds };
      }

      const response = await pjService.getSummary({
        clientId,
        bankAccountId: selectedAccountId!,
        from,
        to,
      });

      const requestIds = [getRequestId(response)].filter((id): id is string => Boolean(id));
      return { summary: response, requestIds };
    },
  });

  const salesKpisQuery = useQuery({
    queryKey: [
      "pj:dashboard:sales-kpis",
      {
        clientId,
        selectedAccountId,
        from,
        to,
        accountIdsKey,
        isAllAccounts,
      },
    ],
    enabled: canQuery,
    queryFn: async () => {
      if (!clientId || !from || !to) {
        return { kpis: null as PJSalesKpis | null, requestIds: [] as string[] };
      }

      if (isAllAccounts) {
        const responses = await Promise.all(
          availableAccounts.map((account) =>
            pjService.getSalesKpis({
              clientId,
              bankAccountId: account.id,
              from,
              to,
            }),
          ),
        );

        const kpis = aggregateSalesKpis(responses);
        const requestIds = responses
          .map((response) => getRequestId(response))
          .filter((id): id is string => Boolean(id));

        return { kpis, requestIds };
      }

      const response = await pjService.getSalesKpis({
        clientId,
        bankAccountId: selectedAccountId!,
        from,
        to,
      });

      const requestIds = [getRequestId(response)].filter((id): id is string => Boolean(id));
      return { kpis: response, requestIds };
    },
  });

  const summary = summaryQuery.data?.summary ?? null;
  const salesKpis = salesKpisQuery.data?.kpis ?? null;

  const uniqueRequestIds = useMemo(() => {
    const ids = [
      ...(summaryQuery.data?.requestIds ?? []),
      ...(salesKpisQuery.data?.requestIds ?? []),
    ];
    return Array.from(new Set(ids));
  }, [summaryQuery.data?.requestIds, salesKpisQuery.data?.requestIds]);

  useRequestIdToasts(uniqueRequestIds, { context: "Dashboard PJ" });

  const summaryErrorRequestId = extractRequestId(summaryQuery.error);
  const salesErrorRequestId = extractRequestId(salesKpisQuery.error);

  if (!clientId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <h2 className="text-2xl font-semibold text-muted-foreground">Selecione um cliente PJ</h2>
        <p className="text-sm text-muted-foreground">
          Os indicadores do dashboard aparecem assim que um cliente PJ for selecionado.
        </p>
      </div>
    );
  }

  if (!isPJClient) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <h2 className="text-2xl font-semibold text-muted-foreground">Cliente sem produtos PJ</h2>
        <p className="text-sm text-muted-foreground">
          Associe uma conta PJ para acompanhar faturamento, vendas e liquidações.
        </p>
      </div>
    );
  }

  if (!selectedAccountId && !isLoadingAccounts) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <h2 className="text-2xl font-semibold text-muted-foreground">Selecione uma conta PJ</h2>
        <p className="text-sm text-muted-foreground">
          Escolha qual conta será usada para consolidar os indicadores do dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="page-pj-dashboard">
      <div className="space-y-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Visão Geral PJ</h1>
          <p className="text-sm text-muted-foreground">
            Acompanhe performance de faturamento e vendas com filtros centralizados.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{accountLabel}</span>
          <Badge variant="secondary">{rangeLabel}</Badge>
        </div>
        {uniqueRequestIds.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {uniqueRequestIds.map((id) => (
              <Badge key={id} variant="outline">
                X-Request-Id: {formatRequestId(id)}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {summaryQuery.isError && (
        <Alert variant="destructive" data-testid="alert-dashboard-summary-error">
          <AlertTitle>Erro ao carregar o resumo</AlertTitle>
          <AlertDescription>
            {(summaryQuery.error as Error).message || "Não foi possível carregar os indicadores."}
            {summaryErrorRequestId && (
              <span className="mt-2 block text-xs text-muted-foreground">
                X-Request-Id: {formatRequestId(summaryErrorRequestId)}
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summaryQuery.isLoading &&
          Array.from({ length: 4 }).map((_, index) => (
            <Card key={index} className="min-h-32">
              <CardContent className="flex h-full flex-col justify-center gap-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-7 w-32" />
              </CardContent>
            </Card>
          ))}

        {summary && (
          <>
            <MetricCard
              title="Receitas"
              value={summary.receitas.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              icon={<TrendingUp className="h-5 w-5" />}
              testId="metric-dashboard-receitas"
            />
            <MetricCard
              title="Despesas"
              value={summary.despesas.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              icon={<CreditCard className="h-5 w-5" />}
              testId="metric-dashboard-despesas"
            />
            <MetricCard
              title="Saldo"
              value={summary.saldo.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              icon={<DollarSign className="h-5 w-5" />}
              testId="metric-dashboard-saldo"
            />
            <MetricCard
              title="Margem líquida"
              value={`${summary.margemLiquida.toFixed(1)}%`}
              prefix=""
              icon={<TrendingUp className="h-5 w-5" />}
              testId="metric-dashboard-margem"
            />
          </>
        )}
      </div>

      {salesKpisQuery.isError && (
        <Alert variant="destructive" data-testid="alert-dashboard-sales-error">
          <AlertTitle>Erro ao carregar vendas</AlertTitle>
          <AlertDescription>
            {(salesKpisQuery.error as Error).message || "Não foi possível carregar os KPIs de vendas."}
            {salesErrorRequestId && (
              <span className="mt-2 block text-xs text-muted-foreground">
                X-Request-Id: {formatRequestId(salesErrorRequestId)}
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Clientes com maior receita</CardTitle>
        </CardHeader>
        <CardContent>
          {!salesKpisQuery.isLoading && salesKpis && (
            <div className="mb-4 flex flex-wrap gap-4 text-sm text-muted-foreground">
              <span>
                Total de vendas: <span className="font-medium text-foreground">{salesKpis.totalSales}</span>
              </span>
              <span>
                Receita consolidada:
                <span className="ml-1 font-medium text-foreground">
                  {formatCurrency(salesKpis.totalRevenue)}
                </span>
              </span>
              <span>
                Ticket médio:
                <span className="ml-1 font-medium text-foreground">
                  {formatCurrency(salesKpis.ticketMedio)}
                </span>
              </span>
            </div>
          )}

          {salesKpisQuery.isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-[80%]" />
              <Skeleton className="h-4 w-[72%]" />
            </div>
          )}

          {!salesKpisQuery.isLoading && salesKpis && salesKpis.topClientes.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {salesKpis.topClientes.map((client) => (
                  <TableRow key={client.customer}>
                    <TableCell className="font-medium">{client.customer}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(client.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {!salesKpisQuery.isLoading && (!salesKpis || salesKpis.topClientes.length === 0) && (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              Nenhuma venda registrada para o período selecionado.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
