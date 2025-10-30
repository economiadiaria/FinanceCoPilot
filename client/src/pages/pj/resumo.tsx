import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/metric-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { TrendingUp, TrendingDown, Wallet, PieChart } from "lucide-react";
import { usePJService } from "@/contexts/PJServiceContext";
import { usePJFilters } from "@/contexts/PJFiltersContext";
import { usePJBankAccounts } from "@/hooks/usePJBankAccounts";
import { formatRangeLabel, toApiDateRange } from "@/lib/date-range";
import { useRequestIdToasts } from "@/hooks/useRequestIdToasts";
import { extractRequestId, formatRequestId } from "@/lib/requestId";
import {
  type PJSummary,
  type PJTrend,
  type PJRevenueSplitItem,
  type PJTopCostItem,
} from "@/services/pj";
import { Badge } from "@/components/ui/badge";

interface ResumoPJProps {
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
      acc.contasReceber += summary.contasReceber;
      acc.lucroBruto += summary.lucroBruto;
      acc.lucroLiquido += summary.lucroLiquido;
      return acc;
    },
    {
      receitas: 0,
      despesas: 0,
      saldo: 0,
      contasReceber: 0,
      lucroBruto: 0,
      lucroLiquido: 0,
    },
  );

  const margemLiquida =
    totals.receitas > 0 ? Number(((totals.lucroLiquido / totals.receitas) * 100).toFixed(1)) : 0;

  return {
    month: "",
    receitas: totals.receitas,
    despesas: totals.despesas,
    saldo: totals.saldo,
    contasReceber: totals.contasReceber,
    lucroBruto: totals.lucroBruto,
    lucroLiquido: totals.lucroLiquido,
    margemLiquida,
    requestId: null,
  };
}

function aggregateTrends(responses: { trends: PJTrend[] }[]): PJTrend[] {
  const map = new Map<string, PJTrend>();
  responses.forEach(({ trends }) => {
    trends.forEach((trend) => {
      const current = map.get(trend.month) ?? { ...trend, receitas: 0, despesas: 0 };
      current.receitas += trend.receitas;
      current.despesas += trend.despesas;
      map.set(trend.month, current);
    });
  });
  return Array.from(map.values());
}

function aggregateRevenueSplit(responses: { revenueSplit: PJRevenueSplitItem[] }[]): PJRevenueSplitItem[] {
  const map = new Map<string, PJRevenueSplitItem>();
  responses.forEach(({ revenueSplit }) => {
    revenueSplit.forEach((item) => {
      const current = map.get(item.channel) ?? { ...item, amount: 0 };
      current.amount += item.amount;
      map.set(item.channel, current);
    });
  });
  return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
}

function aggregateTopCosts(responses: { topCosts: PJTopCostItem[] }[]): PJTopCostItem[] {
  const map = new Map<string, PJTopCostItem>();
  responses.forEach(({ topCosts }) => {
    topCosts.forEach((cost) => {
      const key = `${cost.category}-${cost.item}`;
      const current = map.get(key) ?? { ...cost, total: 0 };
      current.total += cost.total;
      map.set(key, current);
    });
  });
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

export default function ResumoPJ({ clientType }: ResumoPJProps) {
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
      "pj:summary",
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

  const trendsQuery = useQuery({
    queryKey: [
      "pj:trends",
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
        return { trends: [] as PJTrend[], requestIds: [] as string[] };
      }

      if (isAllAccounts) {
        const responses = await Promise.all(
          availableAccounts.map((account) =>
            pjService.getTrends({
              clientId,
              bankAccountId: account.id,
              from,
              to,
            }),
          ),
        );

        const trends = aggregateTrends(responses);
        const requestIds = responses
          .map((response) => getRequestId(response))
          .filter((id): id is string => Boolean(id));

        return { trends, requestIds };
      }

      const response = await pjService.getTrends({
        clientId,
        bankAccountId: selectedAccountId!,
        from,
        to,
      });

      const requestIds = [getRequestId(response)].filter((id): id is string => Boolean(id));
      return { trends: response.trends, requestIds };
    },
  });

  const revenueSplitQuery = useQuery({
    queryKey: [
      "pj:revenue-split",
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
        return { revenueSplit: [] as PJRevenueSplitItem[], requestIds: [] as string[] };
      }

      if (isAllAccounts) {
        const responses = await Promise.all(
          availableAccounts.map((account) =>
            pjService.getRevenueSplit({
              clientId,
              bankAccountId: account.id,
              from,
              to,
            }),
          ),
        );

        const revenueSplit = aggregateRevenueSplit(responses);
        const requestIds = responses
          .map((response) => getRequestId(response))
          .filter((id): id is string => Boolean(id));

        return { revenueSplit, requestIds };
      }

      const response = await pjService.getRevenueSplit({
        clientId,
        bankAccountId: selectedAccountId!,
        from,
        to,
      });

      const requestIds = [getRequestId(response)].filter((id): id is string => Boolean(id));
      return { revenueSplit: response.revenueSplit, requestIds };
    },
  });

  const topCostsQuery = useQuery({
    queryKey: [
      "pj:top-costs",
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
        return { topCosts: [] as PJTopCostItem[], requestIds: [] as string[] };
      }

      if (isAllAccounts) {
        const responses = await Promise.all(
          availableAccounts.map((account) =>
            pjService.getTopCosts({
              clientId,
              bankAccountId: account.id,
              from,
              to,
            }),
          ),
        );

        const topCosts = aggregateTopCosts(responses);
        const requestIds = responses
          .map((response) => getRequestId(response))
          .filter((id): id is string => Boolean(id));

        return { topCosts, requestIds };
      }

      const response = await pjService.getTopCosts({
        clientId,
        bankAccountId: selectedAccountId!,
        from,
        to,
      });

      const requestIds = [getRequestId(response)].filter((id): id is string => Boolean(id));
      return { topCosts: response.topCosts, requestIds };
    },
  });

  const summary = summaryQuery.data?.summary ?? null;
  const trends = trendsQuery.data?.trends ?? [];
  const revenueSplit = revenueSplitQuery.data?.revenueSplit ?? [];
  const topCosts = topCostsQuery.data?.topCosts ?? [];

  const uniqueRequestIds = useMemo(() => {
    const ids = [
      ...(summaryQuery.data?.requestIds ?? []),
      ...(trendsQuery.data?.requestIds ?? []),
      ...(revenueSplitQuery.data?.requestIds ?? []),
      ...(topCostsQuery.data?.requestIds ?? []),
    ];
    return Array.from(new Set(ids));
  }, [
    summaryQuery.data?.requestIds,
    trendsQuery.data?.requestIds,
    revenueSplitQuery.data?.requestIds,
    topCostsQuery.data?.requestIds,
  ]);

  useRequestIdToasts(uniqueRequestIds, { context: "Resumo PJ" });

  const summaryErrorRequestId = extractRequestId(summaryQuery.error);
  const trendsErrorRequestId = extractRequestId(trendsQuery.error);
  const revenueSplitErrorRequestId = extractRequestId(revenueSplitQuery.error);
  const topCostsErrorRequestId = extractRequestId(topCostsQuery.error);

  if (!clientId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <h2 className="text-2xl font-semibold text-muted-foreground">Selecione um cliente PJ</h2>
        <p className="text-sm text-muted-foreground">
          Escolha um cliente para visualizar o resumo financeiro consolidado.
        </p>
      </div>
    );
  }

  if (!isPJClient) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <h2 className="text-2xl font-semibold text-muted-foreground">Cliente sem produtos PJ</h2>
        <p className="text-sm text-muted-foreground">
          Associe uma conta PJ para liberar os indicadores de resumo financeiro.
        </p>
      </div>
    );
  }

  if (!selectedAccountId && !isLoadingAccounts) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <h2 className="text-2xl font-semibold text-muted-foreground">Selecione uma conta PJ</h2>
        <p className="text-sm text-muted-foreground">
          Escolha uma conta bancária PJ para carregar os dados de movimentação.
        </p>
      </div>
    );
  }

  const showSummaryEmpty = !summary && !summaryQuery.isLoading && !summaryQuery.isError;
  const showTrendsEmpty = !trends.length && !trendsQuery.isLoading && !trendsQuery.isError;
  const showRevenueEmpty =
    !revenueSplit.length && !revenueSplitQuery.isLoading && !revenueSplitQuery.isError;
  const showCostsEmpty = !topCosts.length && !topCostsQuery.isLoading && !topCostsQuery.isError;

  return (
    <div className="space-y-6" data-testid="page-pj-resumo">
      <div className="space-y-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Resumo Financeiro</h1>
          <p className="text-sm text-muted-foreground">
            Acompanhe receitas, despesas e canais de venda em um só lugar.
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
        <Alert variant="destructive" data-testid="alert-resumo-error">
          <AlertTitle>Não foi possível carregar o resumo</AlertTitle>
          <AlertDescription>
            {(summaryQuery.error as Error).message || "Tente novamente em instantes."}
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
              title="Receitas do período"
              value={summary.receitas.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              icon={<TrendingUp className="h-5 w-5" />}
              testId="metric-receitas"
            />
            <MetricCard
              title="Despesas do período"
              value={summary.despesas.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              icon={<TrendingDown className="h-5 w-5" />}
              testId="metric-despesas"
            />
            <MetricCard
              title="Saldo consolidado"
              value={summary.saldo.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              icon={<Wallet className="h-5 w-5" />}
              testId="metric-saldo"
            />
            <MetricCard
              title="Margem líquida"
              value={`${summary.margemLiquida.toFixed(1)}%`}
              prefix=""
              icon={<PieChart className="h-5 w-5" />}
              testId="metric-margem"
            />
          </>
        )}

        {showSummaryEmpty && (
          <Card className="md:col-span-2 xl:col-span-4">
            <CardContent className="flex h-full items-center justify-center py-10">
              <p className="text-sm text-muted-foreground">
                Nenhum indicador disponível para o período selecionado.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <Separator />

      {trendsQuery.isError && (
        <Alert variant="destructive" data-testid="alert-trends-error">
          <AlertTitle>Não foi possível carregar a evolução</AlertTitle>
          <AlertDescription>
            {(trendsQuery.error as Error).message || "Tente novamente mais tarde."}
            {trendsErrorRequestId && (
              <span className="mt-2 block text-xs text-muted-foreground">
                X-Request-Id: {formatRequestId(trendsErrorRequestId)}
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Tendências mensais</CardTitle>
        </CardHeader>
        <CardContent>
          {trendsQuery.isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-[92%]" />
              <Skeleton className="h-4 w-[85%]" />
            </div>
          )}

          {showTrendsEmpty && (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              Nenhuma tendência disponível para o período selecionado.
            </div>
          )}

          {!trendsQuery.isLoading && trends.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead className="text-right">Receitas</TableHead>
                  <TableHead className="text-right">Despesas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trends.map((trend) => (
                  <TableRow key={trend.month}>
                    <TableCell>{trend.month}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(trend.receitas)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(trend.despesas)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Separator />

      {revenueSplitQuery.isError && (
        <Alert variant="destructive" data-testid="alert-revenue-error">
          <AlertTitle>Erro ao carregar canais</AlertTitle>
          <AlertDescription>
            {(revenueSplitQuery.error as Error).message ||
              "Não foi possível carregar a divisão de receita."}
            {revenueSplitErrorRequestId && (
              <span className="mt-2 block text-xs text-muted-foreground">
                X-Request-Id: {formatRequestId(revenueSplitErrorRequestId)}
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Receita por canal</CardTitle>
        </CardHeader>
        <CardContent>
          {revenueSplitQuery.isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-[85%]" />
            </div>
          )}

          {showRevenueEmpty && (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              Nenhum canal de receita registrado para o período.
            </div>
          )}

          {!revenueSplitQuery.isLoading && revenueSplit.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Canal</TableHead>
                  <TableHead className="text-right">Receita</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {revenueSplit.map((item) => (
                  <TableRow key={item.channel}>
                    <TableCell className="font-medium">{item.channel}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(item.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Separator />

      {topCostsQuery.isError && (
        <Alert variant="destructive" data-testid="alert-costs-error">
          <AlertTitle>Erro ao carregar principais custos</AlertTitle>
          <AlertDescription>
            {(topCostsQuery.error as Error).message || "Tente novamente mais tarde."}
            {topCostsErrorRequestId && (
              <span className="mt-2 block text-xs text-muted-foreground">
                X-Request-Id: {formatRequestId(topCostsErrorRequestId)}
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Principais custos</CardTitle>
        </CardHeader>
        <CardContent>
          {topCostsQuery.isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-[88%]" />
              <Skeleton className="h-4 w-[76%]" />
            </div>
          )}

          {showCostsEmpty && (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              Nenhum custo encontrado para o período selecionado.
            </div>
          )}

          {!topCostsQuery.isLoading && topCosts.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topCosts.map((cost) => (
                  <TableRow key={`${cost.category}-${cost.item}`}>
                    <TableCell>{cost.category}</TableCell>
                    <TableCell className="font-medium">{cost.item}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(cost.total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
