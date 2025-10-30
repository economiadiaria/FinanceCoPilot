import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MetricCard } from "@/components/metric-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { usePJService } from "@/contexts/PJServiceContext";
import { usePJFilters } from "@/contexts/PJFiltersContext";
import { usePJBankAccounts } from "@/hooks/usePJBankAccounts";
import { formatRangeLabel, toApiDateRange } from "@/lib/date-range";
import { useRequestIdToasts } from "@/hooks/useRequestIdToasts";
import { formatRequestId } from "@/lib/requestId";
import {
  type PJMonthlyInsightsResponse,
  type PJCostBreakdownResponse,
  type PJRevenueChannelHighlight,
  type PJTopSaleHighlight,
  type PJTopCostHighlight,
} from "@/services/pj";
import { BarChart3, FileBarChart2, Wallet, PieChart } from "lucide-react";

interface RelatoriosPJProps {
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
  if (value && typeof value === "object" && "requestId" in value) {
    const casted = value as { requestId?: string | null };
    return casted.requestId ?? null;
  }
  return null;
}

function mergeTopSales(items: PJTopSaleHighlight[]): PJTopSaleHighlight[] {
  const map = new Map<string, PJTopSaleHighlight>();
  items.forEach((item) => {
    const current = map.get(item.saleId);
    if (!current) {
      map.set(item.saleId, { ...item });
    } else {
      map.set(item.saleId, {
        ...current,
        amount: current.amount + item.amount,
        netAmount: current.netAmount + item.netAmount,
      });
    }
  });
  return Array.from(map.values());
}

function mergeTopCosts(items: PJTopCostHighlight[]): PJTopCostHighlight[] {
  const map = new Map<string, PJTopCostHighlight>();
  items.forEach((item) => {
    const current = map.get(item.bankTxId);
    if (!current) {
      map.set(item.bankTxId, { ...item });
    } else {
      map.set(item.bankTxId, {
        ...current,
        amount: current.amount + item.amount,
      });
    }
  });
  return Array.from(map.values());
}

function mergeRevenueChannels(items: PJRevenueChannelHighlight[]): PJRevenueChannelHighlight[] {
  const map = new Map<string, PJRevenueChannelHighlight>();
  items.forEach((item) => {
    const current = map.get(item.channel);
    if (!current) {
      map.set(item.channel, { ...item });
    } else {
      map.set(item.channel, {
        ...current,
        total: current.total + item.total,
        count: current.count + item.count,
      });
    }
  });
  return Array.from(map.values());
}

function aggregateMonthlyInsights(
  responses: PJMonthlyInsightsResponse[],
): PJMonthlyInsightsResponse | null {
  if (!responses.length) {
    return null;
  }

  const first = responses[0];
  const summaryTotals = responses.reduce(
    (acc, insight) => {
      const summary = insight.summary;
      acc.faturamento += summary.faturamento;
      acc.receita += summary.receita;
      acc.despesas += summary.despesas;
      acc.saldo += summary.saldo;
      acc.lucroBruto += summary.lucroBruto;
      acc.lucroLiquido += summary.lucroLiquido;
      acc.ticketMedio += summary.ticketMedio;
      acc.quantidadeVendas += summary.quantidadeVendas;
      acc.deducoesReceita += summary.deducoesReceita;
      acc.despesasGerais += summary.despesasGerais;
      acc.despesasComercialMarketing += summary.despesasComercialMarketing;
      acc.financeiroIn += summary.financeiroIn;
      acc.financeiroOut += summary.financeiroOut;
      acc.outrasIn += summary.outrasIn;
      acc.outrasOut += summary.outrasOut;
      return acc;
    },
    {
      faturamento: 0,
      receita: 0,
      despesas: 0,
      saldo: 0,
      lucroBruto: 0,
      lucroLiquido: 0,
      ticketMedio: 0,
      quantidadeVendas: 0,
      deducoesReceita: 0,
      despesasGerais: 0,
      despesasComercialMarketing: 0,
      financeiroIn: 0,
      financeiroOut: 0,
      outrasIn: 0,
      outrasOut: 0,
    },
  );

  const availableMonths = Array.from(
    new Set(responses.flatMap((insight) => insight.availableMonths)),
  ).sort();

  const totalReceita = summaryTotals.receita;
  const margemLiquida = totalReceita > 0 ? (summaryTotals.lucroLiquido / totalReceita) * 100 : 0;
  const ticketMedio =
    summaryTotals.quantidadeVendas > 0
      ? summaryTotals.receita / summaryTotals.quantidadeVendas
      : summaryTotals.ticketMedio;

  const topVendas = mergeTopSales(responses.flatMap((insight) => insight.highlights.topVendas)).sort(
    (a, b) => b.amount - a.amount,
  );

  const topCustos = mergeTopCosts(responses.flatMap((insight) => insight.highlights.topCustos)).sort(
    (a, b) => b.amount - a.amount,
  );

  const origemReceitaRaw = mergeRevenueChannels(
    responses.flatMap((insight) => insight.highlights.origemReceita),
  );
  const origemReceita = origemReceitaRaw
    .map((item) => ({
      ...item,
      percentage: totalReceita > 0 ? (item.total / totalReceita) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const despesasNaoCategorizadas = responses.reduce(
    (acc, insight) => {
      const value = insight.highlights.despesasNaoCategorizadas;
      acc.total += value.total;
      acc.count += value.count;
      acc.items.push(...value.items);
      return acc;
    },
    { total: 0, count: 0, items: [] as PJMonthlyInsightsResponse["highlights"]["despesasNaoCategorizadas"]["items"] },
  );

  return {
    ...first,
    availableMonths,
    summary: {
      ...first.summary,
      ...summaryTotals,
      margemLiquida,
      ticketMedio,
    },
    highlights: {
      topVendas,
      topCustos,
      origemReceita,
      despesasNaoCategorizadas,
    },
    requestId: null,
  };
}

function aggregateCostBreakdown(
  responses: PJCostBreakdownResponse[],
): PJCostBreakdownResponse | null {
  if (!responses.length) {
    return null;
  }

  const first = responses[0];
  const totals = responses.reduce(
    (acc, response) => {
      acc.inflows += response.totals.inflows;
      acc.outflows += response.totals.outflows;
      acc.net += response.totals.net;
      acc.uncategorizedTotal += response.uncategorized.total;
      acc.uncategorizedCount += response.uncategorized.count;
      acc.uncategorizedItems.push(...response.uncategorized.items);
      return acc;
    },
    {
      inflows: 0,
      outflows: 0,
      net: 0,
      uncategorizedTotal: 0,
      uncategorizedCount: 0,
      uncategorizedItems: [] as PJCostBreakdownResponse["uncategorized"]["items"],
    },
  );

  const groupsMap = new Map<
    string,
    {
      key: string;
      label: string;
      group: string;
      inflows: number;
      outflows: number;
      net: number;
    }
  >();

  responses.forEach((response) => {
    response.groups.forEach((group) => {
      const current = groupsMap.get(group.key) ?? {
        key: group.key,
        label: group.label,
        group: group.group,
        inflows: 0,
        outflows: 0,
        net: 0,
      };
      current.inflows += group.inflows;
      current.outflows += group.outflows;
      current.net += group.net;
      groupsMap.set(group.key, current);
    });
  });

  const groups = Array.from(groupsMap.values()).sort((a, b) => b.inflows - a.inflows);
  const availableMonths = Array.from(
    new Set(responses.flatMap((response) => response.availableMonths)),
  ).sort();

  return {
    ...first,
    availableMonths,
    totals: {
      inflows: totals.inflows,
      outflows: totals.outflows,
      net: totals.net,
    },
    groups: groups.map((group) => ({
      key: group.key,
      label: group.label,
      group: group.group,
      inflows: group.inflows,
      outflows: group.outflows,
      net: group.net,
      items: [],
    })),
    uncategorized: {
      total: totals.uncategorizedTotal,
      count: totals.uncategorizedCount,
      items: totals.uncategorizedItems,
    },
    requestId: null,
  };
}

export default function RelatoriosPJ({ clientType }: RelatoriosPJProps) {
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
  const monthParam = from ? from.slice(0, 7) : undefined;

  const canQuery = Boolean(
    clientId &&
      from &&
      to &&
      isPJClient &&
      (isAllAccounts ? availableAccounts.length > 0 : selectedAccountId),
  );

  const insightsQuery = useQuery({
    queryKey: [
      "pj:monthly-insights",
      { clientId, selectedAccountId, from, to, monthParam, accountIdsKey, isAllAccounts },
    ],
    enabled: canQuery,
    queryFn: async () => {
      if (!clientId || !from || !to) {
        return { insights: null as PJMonthlyInsightsResponse | null, requestIds: [] as string[] };
      }

      if (isAllAccounts) {
        const responses = await Promise.all(
          availableAccounts.map((account) =>
            pjService.getMonthlyInsights({
              clientId,
              bankAccountId: account.id,
              from,
              to,
              month: monthParam,
            }),
          ),
        );

        const insights = aggregateMonthlyInsights(responses);
        const requestIds = responses
          .map((response) => getRequestId(response))
          .filter((id): id is string => Boolean(id));

        return { insights, requestIds };
      }

      const response = await pjService.getMonthlyInsights({
        clientId,
        bankAccountId: selectedAccountId!,
        from,
        to,
        month: monthParam,
      });

      const requestIds = [getRequestId(response)].filter((id): id is string => Boolean(id));
      return { insights: response, requestIds };
    },
  });

  const costBreakdownQuery = useQuery({
    queryKey: [
      "pj:cost-breakdown",
      { clientId, selectedAccountId, from, to, monthParam, accountIdsKey, isAllAccounts },
    ],
    enabled: canQuery,
    queryFn: async () => {
      if (!clientId || !from || !to) {
        return { breakdown: null as PJCostBreakdownResponse | null, requestIds: [] as string[] };
      }

      if (isAllAccounts) {
        const responses = await Promise.all(
          availableAccounts.map((account) =>
            pjService.getCostBreakdown({
              clientId,
              bankAccountId: account.id,
              from,
              to,
              month: monthParam,
            }),
          ),
        );

        const breakdown = aggregateCostBreakdown(responses);
        const requestIds = responses
          .map((response) => getRequestId(response))
          .filter((id): id is string => Boolean(id));

        return { breakdown, requestIds };
      }

      const response = await pjService.getCostBreakdown({
        clientId,
        bankAccountId: selectedAccountId!,
        from,
        to,
        month: monthParam,
      });

      const requestIds = [getRequestId(response)].filter((id): id is string => Boolean(id));
      return { breakdown: response, requestIds };
    },
  });

  const insights = insightsQuery.data?.insights ?? null;
  const costBreakdown = costBreakdownQuery.data?.breakdown ?? null;

  const uniqueRequestIds = useMemo(() => {
    const ids = [
      ...(insightsQuery.data?.requestIds ?? []),
      ...(costBreakdownQuery.data?.requestIds ?? []),
    ];
    return Array.from(new Set(ids));
  }, [insightsQuery.data?.requestIds, costBreakdownQuery.data?.requestIds]);

  useRequestIdToasts(uniqueRequestIds, { context: "Relatórios PJ" });

  if (!clientId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <h2 className="text-2xl font-semibold text-muted-foreground">Selecione um cliente PJ</h2>
        <p className="text-sm text-muted-foreground">
          Relatórios consolidados ficam disponíveis após escolher um cliente PJ.
        </p>
      </div>
    );
  }

  if (!isPJClient) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <h2 className="text-2xl font-semibold text-muted-foreground">Cliente sem produtos PJ</h2>
        <p className="text-sm text-muted-foreground">
          Associe uma conta PJ para liberar os relatórios de desempenho e custos.
        </p>
      </div>
    );
  }

  if (!selectedAccountId && !isLoadingAccounts) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <h2 className="text-2xl font-semibold text-muted-foreground">Selecione uma conta PJ</h2>
        <p className="text-sm text-muted-foreground">
          Escolha uma conta para exibir os relatórios e indicadores do período.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="page-pj-relatorios">
      <div className="space-y-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Relatórios Analíticos</h1>
          <p className="text-sm text-muted-foreground">
            Explore indicadores de receita, margem e composição de custos usando os dados mockados.
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

      {insightsQuery.isError && (
        <Alert variant="destructive" data-testid="alert-insights-error">
          <AlertTitle>Erro ao carregar indicadores</AlertTitle>
          <AlertDescription>
            {(insightsQuery.error as Error).message ||
              "Não foi possível carregar os indicadores do período."}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {insightsQuery.isLoading &&
          Array.from({ length: 4 }).map((_, index) => (
            <Card key={index} className="min-h-32">
              <CardContent className="flex h-full flex-col justify-center gap-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-7 w-32" />
              </CardContent>
            </Card>
          ))}

        {insights && (
          <>
            <MetricCard
              title="Faturamento"
              value={insights.summary.faturamento.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              icon={<BarChart3 className="h-5 w-5" />}
              testId="metric-faturamento"
            />
            <MetricCard
              title="Receita"
              value={insights.summary.receita.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              icon={<FileBarChart2 className="h-5 w-5" />}
              testId="metric-receita"
            />
            <MetricCard
              title="Lucro líquido"
              value={insights.summary.lucroLiquido.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              icon={<Wallet className="h-5 w-5" />}
              testId="metric-lucro"
            />
            <MetricCard
              title="Margem líquida"
              value={`${insights.summary.margemLiquida.toFixed(1)}%`}
              prefix=""
              icon={<PieChart className="h-5 w-5" />}
              testId="metric-margem"
            />
          </>
        )}
      </div>

      {costBreakdownQuery.isError && (
        <Alert variant="destructive" data-testid="alert-costs-error">
          <AlertTitle>Erro ao carregar estrutura de custos</AlertTitle>
          <AlertDescription>
            {(costBreakdownQuery.error as Error).message || "Tente novamente mais tarde."}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Resumo de custos</CardTitle>
        </CardHeader>
        <CardContent>
          {costBreakdownQuery.isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-[92%]" />
              <Skeleton className="h-4 w-[80%]" />
            </div>
          )}

          {!costBreakdownQuery.isLoading && costBreakdown && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Grupo</TableHead>
                  <TableHead className="text-right">Entradas</TableHead>
                  <TableHead className="text-right">Saídas</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {costBreakdown.groups.map((group) => (
                  <TableRow key={group.key}>
                    <TableCell className="font-medium">{group.label}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(group.inflows)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(group.outflows)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(group.net)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {!costBreakdownQuery.isLoading && !costBreakdown && (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              Nenhum dado de custos disponível para o período selecionado.
            </div>
          )}
        </CardContent>
      </Card>

      {insights && (
        <Card>
          <CardHeader>
            <CardTitle>Destaques de receita e despesas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Principais vendas</h3>
              <div className="mt-2 space-y-2">
                {insights.highlights.topVendas.slice(0, 5).map((sale) => (
                  <div key={sale.saleId} className="flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">{sale.customer}</span>
                    <span className="tabular-nums">{formatCurrency(sale.amount)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Principais custos</h3>
              <div className="mt-2 space-y-2">
                {insights.highlights.topCustos.slice(0, 5).map((cost) => (
                  <div key={cost.bankTxId} className="flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">{cost.desc}</span>
                    <span className="tabular-nums">{formatCurrency(cost.amount)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Canais de receita</h3>
              <div className="mt-2 space-y-2">
                {insights.highlights.origemReceita.slice(0, 5).map((channel) => (
                  <div key={channel.channel} className="flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">{channel.channel}</span>
                    <span className="tabular-nums">{formatCurrency(channel.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
