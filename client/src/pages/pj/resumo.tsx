import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/metric-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { TrendingUp, TrendingDown, Wallet, PieChart, FileBarChart } from "lucide-react";
import { usePJService } from "@/contexts/PJServiceContext";
import {
  getSummary,
  type PJSummary,
  type PJTrend,
  type PJRevenueSplitItem,
  type PJTopCostItem,
} from "@/services/pj";

interface ResumoPJProps {
  clientId: string | null;
  clientType: string | null;
  bankAccountId: string | null;
}

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

function formatTrendLabel(period: string) {
  return period;
}

export default function ResumoPJ({ clientId, clientType, bankAccountId }: ResumoPJProps) {
  const pjService = usePJService();
  const isPJClient = clientType === "PJ" || clientType === "BOTH";

  const { from, to, currentYear } = useMemo(() => {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return {
      from: firstDay.toISOString().split("T")[0],
      to: lastDay.toISOString().split("T")[0],
      currentYear: today.getFullYear().toString(),
    };
  }, []);

  const summaryQuery = useQuery<PJSummary>({
    queryKey: ["pj:summary", { clientId, bankAccountId, from, to }],
    enabled: Boolean(clientId && bankAccountId && isPJClient),
    queryFn: () =>
      getSummary({
        clientId: clientId!,
        bankAccountId: bankAccountId!,
        from,
        to,
      }),
  });

  const trendsQuery = useQuery<{ trends: PJTrend[] }>({
    queryKey: ["pj:trends", { clientId, bankAccountId, currentYear }],
    enabled: Boolean(clientId && bankAccountId && isPJClient),
    queryFn: () =>
      pjService.getTrends({
        clientId: clientId!,
        bankAccountId: bankAccountId!,
        year: currentYear,
      }),
  });

  const revenueSplitQuery = useQuery<{ revenueSplit: PJRevenueSplitItem[] }>({
    queryKey: ["pj:revenue-split", { clientId, bankAccountId }],
    enabled: Boolean(clientId && bankAccountId && isPJClient),
    queryFn: () =>
      pjService.getRevenueSplit({
        clientId: clientId!,
        bankAccountId: bankAccountId!,
        month: from.slice(0, 7),
      }),
  });

  const topCostsQuery = useQuery<{ topCosts: PJTopCostItem[] }>({
    queryKey: ["pj:top-costs", { clientId, bankAccountId }],
    enabled: Boolean(clientId && bankAccountId && isPJClient),
    queryFn: () =>
      pjService.getTopCosts({
        clientId: clientId!,
        bankAccountId: bankAccountId!,
        month: from.slice(0, 7),
      }),
  });

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

  if (!bankAccountId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <h2 className="text-2xl font-semibold text-muted-foreground">Selecione uma conta PJ</h2>
        <p className="text-sm text-muted-foreground">
          Escolha uma conta bancária PJ para carregar os dados de movimentação.
        </p>
      </div>
    );
  }

  const summary = summaryQuery.data;
  const trends = trendsQuery.data?.trends ?? [];
  const revenueSplit = revenueSplitQuery.data?.revenueSplit ?? [];
  const topCosts = topCostsQuery.data?.topCosts ?? [];

  const showSummaryEmpty = !summary && !summaryQuery.isLoading && !summaryQuery.isError;
  const showTrendsEmpty = !trends.length && !trendsQuery.isLoading && !trendsQuery.isError;
  const showRevenueEmpty = !revenueSplit.length && !revenueSplitQuery.isLoading && !revenueSplitQuery.isError;
  const showCostsEmpty = !topCosts.length && !topCostsQuery.isLoading && !topCostsQuery.isError;

  return (
    <div className="space-y-6" data-testid="page-pj-resumo">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Resumo Financeiro</h1>
        <p className="text-sm text-muted-foreground">
          Acompanhe receitas, despesas e canais de venda em um só lugar.
        </p>
      </div>

      {summaryQuery.isError && (
        <Alert variant="destructive" data-testid="alert-resumo-error">
          <AlertTitle>Não foi possível carregar o resumo</AlertTitle>
          <AlertDescription>
            {(summaryQuery.error as Error).message || "Tente novamente em instantes."}
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
              title="Receitas do mês"
              value={summary.receitas.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              icon={<TrendingUp className="h-5 w-5" />}
              testId="metric-receitas"
            />
            <MetricCard
              title="Despesas do mês"
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
              <p className="text-sm text-muted-foreground">Nenhuma informação consolidada para o período selecionado.</p>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Evolução mensal</CardTitle>
          </CardHeader>
          <CardContent>
            {trendsQuery.isError && (
              <Alert variant="destructive" className="mb-4" data-testid="alert-trends-error">
                <AlertTitle>Erro ao carregar evolução</AlertTitle>
                <AlertDescription>
                  {(trendsQuery.error as Error).message || "Não conseguimos carregar a evolução mensal."}
                </AlertDescription>
              </Alert>
            )}

            {trendsQuery.isLoading && (
              <div className="space-y-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-[80%]" />
                <Skeleton className="h-4 w-[65%]" />
              </div>
            )}

            {showTrendsEmpty && (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
                Nenhum histórico disponível para o ano selecionado.
              </div>
            )}

            {!trendsQuery.isLoading && trends.length > 0 && (
              <div className="space-y-4">
                {trends.map((trend) => (
                  <div key={trend.month} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between text-sm font-medium">
                      <span>{formatTrendLabel(trend.month)}</span>
                      <span className="text-muted-foreground">{formatCurrency(trend.receitas)}</span>
                    </div>
                    <Separator className="my-3" />
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>Despesas</span>
                      <span>{formatCurrency(trend.despesas)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Divisão de receita por canal</CardTitle>
          </CardHeader>
          <CardContent>
            {revenueSplitQuery.isError && (
              <Alert variant="destructive" className="mb-4" data-testid="alert-revenue-error">
                <AlertTitle>Erro ao carregar canais</AlertTitle>
                <AlertDescription>
                  {(revenueSplitQuery.error as Error).message || "Tente novamente em instantes."}
                </AlertDescription>
              </Alert>
            )}

            {revenueSplitQuery.isLoading && (
              <div className="space-y-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-[70%]" />
                <Skeleton className="h-4 w-[60%]" />
              </div>
            )}

            {showRevenueEmpty && (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
                Nenhuma receita foi registrada neste período.
              </div>
            )}

            {!revenueSplitQuery.isLoading && revenueSplit.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Canal</TableHead>
                    <TableHead className="text-right">Faturamento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {revenueSplit.map((item) => (
                    <TableRow key={item.channel}>
                      <TableCell className="font-medium">{item.channel}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(item.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Principais centros de custo</CardTitle>
        </CardHeader>
        <CardContent>
          {topCostsQuery.isError && (
            <Alert variant="destructive" className="mb-4" data-testid="alert-costs-error">
              <AlertTitle>Erro ao carregar custos</AlertTitle>
              <AlertDescription>
                {(topCostsQuery.error as Error).message || "Não foi possível trazer os custos."}
              </AlertDescription>
            </Alert>
          )}

          {topCostsQuery.isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-[75%]" />
              <Skeleton className="h-4 w-[65%]" />
            </div>
          )}

          {showCostsEmpty && (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
              Nenhum custo recorrente cadastrado para o mês atual.
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
                    <TableCell className="font-medium">{cost.category}</TableCell>
                    <TableCell>{cost.item}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(cost.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2 font-medium text-primary">
          <FileBarChart className="h-4 w-4" />
          <span>Dados simulados</span>
        </div>
        <p className="mt-2">
          Todos os indicadores são fornecidos pelo serviço mockado da plataforma, permitindo validar a
          experiência de navegação e os estados de carregamento, erro e ausência de dados.
        </p>
      </div>
    </div>
  );
}
