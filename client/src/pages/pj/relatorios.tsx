import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MetricCard } from "@/components/metric-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileBarChart2, PieChart, Wallet, TrendingUp } from "lucide-react";
import { usePJService } from "@/contexts/PJServiceContext";
import type { PJMonthlyInsightsResponse, PJCostBreakdownResponse } from "@/services/pj";

interface RelatoriosPJProps {
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

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

export default function RelatoriosPJ({ clientId, clientType, bankAccountId }: RelatoriosPJProps) {
  const pjService = usePJService();
  const isPJClient = clientType === "PJ" || clientType === "BOTH";
  const [selectedMonth, setSelectedMonth] = useState<string | undefined>(undefined);

  const insightsQuery = useQuery<PJMonthlyInsightsResponse>({
    queryKey: ["pj:monthly-insights", { clientId, bankAccountId, selectedMonth }],
    enabled: Boolean(clientId && bankAccountId && isPJClient),
    queryFn: () =>
      pjService.getMonthlyInsights({
        clientId: clientId!,
        bankAccountId: bankAccountId!,
        month: selectedMonth,
      }),
  });

  const costBreakdownQuery = useQuery<PJCostBreakdownResponse>({
    queryKey: ["pj:cost-breakdown", { clientId, bankAccountId, selectedMonth }],
    enabled: Boolean(clientId && bankAccountId && isPJClient),
    queryFn: () =>
      pjService.getCostBreakdown({
        clientId: clientId!,
        bankAccountId: bankAccountId!,
        month: selectedMonth,
      }),
  });

  const availableMonths = useMemo(
    () => insightsQuery.data?.availableMonths ?? [],
    [insightsQuery.data?.availableMonths],
  );

  useEffect(() => {
    if (!availableMonths.length) return;
    if (!selectedMonth) {
      setSelectedMonth(insightsQuery.data?.month ?? availableMonths[availableMonths.length - 1]);
    }
  }, [availableMonths, insightsQuery.data?.month, selectedMonth]);

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

  if (!bankAccountId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <h2 className="text-2xl font-semibold text-muted-foreground">Selecione uma conta PJ</h2>
        <p className="text-sm text-muted-foreground">
          Escolha uma conta para exibir os relatórios e indicadores do período.
        </p>
      </div>
    );
  }

  const summary = insightsQuery.data?.summary;
  const highlights = insightsQuery.data?.highlights;
  const costs = costBreakdownQuery.data;

  const showInsightsEmpty =
    !insightsQuery.isLoading && !insightsQuery.isError && (!summary || !highlights);
  const showCostsEmpty = !costBreakdownQuery.isLoading && !costBreakdownQuery.isError && !costs;

  return (
    <div className="space-y-6" data-testid="page-pj-relatorios">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Relatórios Analíticos</h1>
          <p className="text-sm text-muted-foreground">
            Explore indicadores de receita, margem e composição de custos usando os dados mockados.
          </p>
        </div>
        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="w-[220px]" data-testid="select-relatorios-period">
            <SelectValue placeholder="Mês de referência" />
          </SelectTrigger>
          <SelectContent>
            {availableMonths.map((month) => (
              <SelectItem key={month} value={month}>
                {new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1).toLocaleDateString("pt-BR", {
                  month: "long",
                  year: "numeric",
                })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {insightsQuery.isError && (
        <Alert variant="destructive" data-testid="alert-insights-error">
          <AlertTitle>Erro ao carregar indicadores</AlertTitle>
          <AlertDescription>
            {(insightsQuery.error as Error).message || "Não foi possível carregar os indicadores do período."}
          </AlertDescription>
        </Alert>
      )}

      {costBreakdownQuery.isError && (
        <Alert variant="destructive" data-testid="alert-costs-error">
          <AlertTitle>Erro ao carregar estrutura de custos</AlertTitle>
          <AlertDescription>
            {(costBreakdownQuery.error as Error).message || "Tente novamente mais tarde."}
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

        {summary && (
          <>
            <MetricCard
              title="Faturamento"
              value={summary.faturamento.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              icon={<TrendingUp className="h-5 w-5" />}
              testId="metric-faturamento"
            />
            <MetricCard
              title="Receita"
              value={summary.receita.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              icon={<Wallet className="h-5 w-5" />}
              testId="metric-receita"
            />
            <MetricCard
              title="Lucro líquido"
              value={summary.lucroLiquido.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              icon={<FileBarChart2 className="h-5 w-5" />}
              testId="metric-lucro"
            />
            <MetricCard
              title="Margem líquida"
              value={formatPercent(summary.margemLiquida)}
              prefix=""
              icon={<PieChart className="h-5 w-5" />}
              testId="metric-margem"
            />
          </>
        )}

        {showInsightsEmpty && (
          <Card className="md:col-span-2 xl:col-span-4">
            <CardContent className="flex h-full items-center justify-center py-10">
              <p className="text-sm text-muted-foreground">
                Nenhum indicador disponível para o período escolhido.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <Tabs defaultValue="insights" className="w-full">
        <TabsList className="grid w-full grid-cols-2 md:w-auto">
          <TabsTrigger value="insights">Indicadores</TabsTrigger>
          <TabsTrigger value="custos">Estrutura de custos</TabsTrigger>
        </TabsList>
        <TabsContent value="insights" className="space-y-4">
          {insightsQuery.isLoading && (
            <Card>
              <CardContent className="space-y-3 py-6">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-[85%]" />
                <Skeleton className="h-4 w-[70%]" />
              </CardContent>
            </Card>
          )}

          {showInsightsEmpty && (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Nenhum destaque encontrado neste período.
              </CardContent>
            </Card>
          )}

          {!insightsQuery.isLoading && highlights && (
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Top vendas</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cliente</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {highlights.topVendas.map((item) => (
                        <TableRow key={item.saleId}>
                          <TableCell>{item.customer}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(item.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Top custos</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Categoria</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {highlights.topCustos.map((item) => (
                        <TableRow key={item.bankTxId}>
                          <TableCell>{item.groupLabel}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(item.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle>Origem da receita</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Canal</TableHead>
                        <TableHead className="text-right">Participação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {highlights.origemReceita.map((item) => (
                        <TableRow key={item.channel}>
                          <TableCell>{item.channel}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(item.total)} ({item.percentage.toFixed(1)}%)
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="custos">
          {costBreakdownQuery.isLoading && (
            <Card>
              <CardContent className="space-y-3 py-6">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-[85%]" />
                <Skeleton className="h-4 w-[60%]" />
              </CardContent>
            </Card>
          )}

          {showCostsEmpty && (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Nenhuma estrutura de custo disponível para este período.
              </CardContent>
            </Card>
          )}

          {!costBreakdownQuery.isLoading && costs && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Totais</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-3">
                  <div>
                    <p className="text-sm text-muted-foreground">Entradas</p>
                    <p className="text-lg font-semibold tabular-nums">{formatCurrency(costs.totals.inflows)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Saídas</p>
                    <p className="text-lg font-semibold tabular-nums">{formatCurrency(costs.totals.outflows)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Resultado</p>
                    <p className="text-lg font-semibold tabular-nums">{formatCurrency(costs.totals.net)}</p>
                  </div>
                </CardContent>
              </Card>

              {costs.groups.map((group) => (
                <Card key={group.key}>
                  <CardHeader>
                    <CardTitle>{group.label}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-right">Entradas</TableHead>
                          <TableHead className="text-right">Saídas</TableHead>
                          <TableHead className="text-right">Resultado</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.items.map((item) => (
                          <TableRow key={item.key}>
                            <TableCell>{item.label}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(item.inflows)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(item.outflows)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(item.net)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              ))}

              {costs.uncategorized?.items.length ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Despesas não categorizadas</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Data</TableHead>
                          <TableHead>Descrição</TableHead>
                          <TableHead className="text-right">Valor</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {costs.uncategorized.items.map((item) => (
                          <TableRow key={item.bankTxId}>
                            <TableCell>
                              {new Date(item.date).toLocaleDateString("pt-BR")}
                            </TableCell>
                            <TableCell>{item.desc}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(item.amount)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2 font-medium text-primary">
          <FileBarChart2 className="h-4 w-4" />
          <span>Serviço mockado</span>
        </div>
        <p className="mt-2">
          Os relatórios são abastecidos pelo serviço mockado de PJ, garantindo exemplos de carregamento, erro e
          estados vazios para validação da experiência.
        </p>
      </div>
    </div>
  );
}
