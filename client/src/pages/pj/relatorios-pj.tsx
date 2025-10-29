import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { MetricCard } from "@/components/metric-card";
import { Separator } from "@/components/ui/separator";
import { AlertCircle, BarChart3, FileBarChart } from "lucide-react";
import { usePJService } from "@/contexts/PJServiceContext";
import type {
  PJMonthlyInsightsResponse,
  PJCostBreakdownResponse,
  PJDashboardMonthlySummary,
} from "@/services/pj";

interface RelatoriosPJProps {
  clientId: string | null;
  clientType: string | null;
  bankAccountId: string | null;
}

const ledgerLabels: Record<string, string> = {
  RECEITA: "Receitas",
  DEDUCOES_RECEITA: "(-) Deduções da Receita",
  GEA: "(-) Despesas Gerais e Administrativas",
  COMERCIAL_MKT: "(-) Despesas Comerciais e Marketing",
  FINANCEIRAS: "(-/+) Despesas e Receitas Financeiras",
  OUTRAS: "(-/+) Outras Despesas e Receitas Não Operacionais",
};

function formatMonth(period: string) {
  const [year, month] = period.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

function formatNumber(value: number) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 0 });
}

export default function RelatoriosPJ({ clientId, clientType, bankAccountId }: RelatoriosPJProps) {
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const faturamentoChartRef = useRef<HTMLCanvasElement>(null);
  const faturamentoChartInstance = useRef<any>(null);
  const lucroChartRef = useRef<HTMLCanvasElement>(null);
  const lucroChartInstance = useRef<any>(null);
  const caixaChartRef = useRef<HTMLCanvasElement>(null);
  const caixaChartInstance = useRef<any>(null);
  const pjService = usePJService();

  const isPJClient = clientType === "PJ" || clientType === "BOTH";

  const { data: insights, isLoading: loadingInsights } = useQuery<PJMonthlyInsightsResponse>({
    queryKey: [
      "/api/pj/dashboard/monthly-insights",
      { clientId, month: selectedMonth ?? undefined, bankAccountId },
    ],
    enabled: !!clientId && !!bankAccountId && isPJClient,
    queryFn: () =>
      pjService.getMonthlyInsights({
        clientId: clientId!,
        bankAccountId: bankAccountId!,
        month: selectedMonth ?? undefined,
      }),
  });

  const { data: costBreakdown } = useQuery<PJCostBreakdownResponse>({
    queryKey: [
      "/api/pj/dashboard/costs-breakdown",
      { clientId, month: selectedMonth ?? undefined, bankAccountId },
    ],
    enabled: !!clientId && !!bankAccountId && isPJClient,
    queryFn: () =>
      pjService.getCostBreakdown({
        clientId: clientId!,
        bankAccountId: bankAccountId!,
        month: selectedMonth ?? undefined,
      }),
  });

  useEffect(() => {
    setSelectedMonth(null);
  }, [bankAccountId]);

  useEffect(() => {
    if (!selectedMonth && insights?.month) {
      setSelectedMonth(insights.month);
    }
  }, [insights?.month, selectedMonth]);

  const summary = insights?.summary;

  const previousSummary = useMemo(() => {
    if (!insights?.charts?.faturamentoVsReceita.labels?.length) {
      return null;
    }
    const { labels } = insights.charts.faturamentoVsReceita;
    if (labels.length < 2) return null;
    const prevMonth = labels[labels.length - 2];
    return buildSyntheticSummary(insights, prevMonth);
  }, [insights]);

  useEffect(() => {
    const Chart = (window as any).Chart;
    if (!Chart) return;

    if (!insights?.charts?.faturamentoVsReceita || !faturamentoChartRef.current) {
      faturamentoChartInstance.current?.destroy();
      faturamentoChartInstance.current = null;
    } else {
      const ctx = faturamentoChartRef.current.getContext("2d");
      if (!ctx) return;
      faturamentoChartInstance.current?.destroy();
      faturamentoChartInstance.current = new Chart(ctx, {
        type: "bar",
        data: {
          labels: insights.charts.faturamentoVsReceita.labels.map(formatMonth),
          datasets: [
            {
              label: "Faturamento",
              data: insights.charts.faturamentoVsReceita.faturamento,
              backgroundColor: "rgba(38, 180, 198, 0.6)",
            },
            {
              label: "Receita",
              data: insights.charts.faturamentoVsReceita.receita,
              backgroundColor: "rgba(13, 23, 99, 0.6)",
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "top" },
          },
        },
      });
    }

    return () => {
      faturamentoChartInstance.current?.destroy();
      faturamentoChartInstance.current = null;
    };
  }, [insights?.charts?.faturamentoVsReceita]);

  useEffect(() => {
    const Chart = (window as any).Chart;
    if (!Chart) return;

    if (!insights?.charts?.lucroEMargem || !lucroChartRef.current) {
      lucroChartInstance.current?.destroy();
      lucroChartInstance.current = null;
    } else {
      const ctx = lucroChartRef.current.getContext("2d");
      if (!ctx) return;
      lucroChartInstance.current?.destroy();
      lucroChartInstance.current = new Chart(ctx, {
        type: "line",
        data: {
          labels: insights.charts.lucroEMargem.labels.map(formatMonth),
          datasets: [
            {
              type: "bar",
              label: "Lucro Líquido",
              data: insights.charts.lucroEMargem.lucroLiquido,
              backgroundColor: "rgba(2, 0, 37, 0.6)",
              yAxisID: "y",
            },
            {
              type: "line",
              label: "Margem Líquida (%)",
              data: insights.charts.lucroEMargem.margemLiquida,
              borderColor: "rgba(38, 180, 198, 1)",
              backgroundColor: "rgba(38, 180, 198, 0.2)",
              yAxisID: "y1",
              tension: 0.4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true,
              position: "left",
            },
            y1: {
              beginAtZero: true,
              position: "right",
              grid: { drawOnChartArea: false },
            },
          },
          plugins: {
            legend: { position: "top" },
          },
        },
      });
    }

    return () => {
      lucroChartInstance.current?.destroy();
      lucroChartInstance.current = null;
    };
  }, [insights?.charts?.lucroEMargem]);

  useEffect(() => {
    const Chart = (window as any).Chart;
    if (!Chart) return;

    if (!insights?.charts?.evolucaoCaixa || !caixaChartRef.current) {
      caixaChartInstance.current?.destroy();
      caixaChartInstance.current = null;
    } else {
      const ctx = caixaChartRef.current.getContext("2d");
      if (!ctx) return;
      caixaChartInstance.current?.destroy();
      caixaChartInstance.current = new Chart(ctx, {
        type: "line",
        data: {
          labels: insights.charts.evolucaoCaixa.labels,
          datasets: [
            {
              label: "Saldo Acumulado",
              data: insights.charts.evolucaoCaixa.saldo,
              borderColor: "rgba(2, 0, 37, 0.8)",
              backgroundColor: "rgba(2, 0, 37, 0.2)",
              tension: 0.4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "top" },
          },
        },
      });
    }

    return () => {
      caixaChartInstance.current?.destroy();
      caixaChartInstance.current = null;
    };
  }, [insights?.charts?.evolucaoCaixa]);

  if (!clientId) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <AlertCircle className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-2xl font-bold text-muted-foreground">
          Selecione um cliente PJ para acessar os relatórios
        </h1>
        <p className="text-muted-foreground">Escolha um cliente com acesso PJ para continuar.</p>
      </div>
    );
  }

  if (!isPJClient) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <BarChart3 className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-2xl font-bold text-muted-foreground">
          Relatórios empresariais exclusivos para clientes PJ
        </h1>
        <p className="text-muted-foreground">
          Altere o tipo do cliente para Pessoa Jurídica para acessar esta visão.
        </p>
      </div>
    );
  }

  if (!bankAccountId) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <FileBarChart className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-2xl font-bold text-muted-foreground">Selecione uma conta PJ</h1>
        <p className="text-muted-foreground">
          Escolha uma conta bancária para visualizar os relatórios financeiros.
        </p>
      </div>
    );
  }

  const noData = !loadingInsights && (!insights || !insights.month);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-relatorios-pj-title">
            Relatórios PJ
          </h1>
          <p className="text-muted-foreground">Valide métricas com base nas vendas e extratos importados</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Select
            value={selectedMonth ?? undefined}
            onValueChange={(value) => setSelectedMonth(value)}
            disabled={!insights?.availableMonths?.length}
          >
            <SelectTrigger className="w-[220px]" data-testid="select-month">
              <SelectValue placeholder="Selecione o mês" />
            </SelectTrigger>
            <SelectContent>
              {insights?.availableMonths.map((monthOption) => (
                <SelectItem key={monthOption} value={monthOption}>
                  {formatMonth(monthOption)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {summary && insights?.month && (
            <div className="text-sm text-muted-foreground">
              Atualizado para <span className="font-medium">{formatMonth(insights.month)}</span>
            </div>
          )}
        </div>
      </div>

      {noData ? (
        <Alert variant="destructive" data-testid="alert-no-data">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Nenhum dado encontrado</AlertTitle>
          <AlertDescription>
            Importe vendas ou extratos OFX para que possamos calcular os indicadores e relatórios deste cliente.
          </AlertDescription>
        </Alert>
      ) : (
        <Tabs defaultValue="mensal" className="space-y-6">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="mensal">Visão Mensal</TabsTrigger>
            <TabsTrigger value="dfc">Fluxo de Caixa / Custos</TabsTrigger>
          </TabsList>

          <TabsContent value="mensal" className="space-y-6">
            {summary ? (
              <>
                <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
                  <MetricCard
                    title="Faturamento"
                    value={formatCurrency(summary.faturamento)}
                    prefix=""
                    testId="metric-faturamento"
                  />
                  <MetricCard
                    title="Receita"
                    value={formatCurrency(summary.receita)}
                    prefix=""
                    testId="metric-receita"
                  />
                  <MetricCard
                    title="Lucro Líquido"
                    value={formatCurrency(summary.lucroLiquido)}
                    prefix=""
                    testId="metric-lucro-liquido"
                  />
                  <MetricCard
                    title="Margem Líquida"
                    value={`${summary.margemLiquida.toFixed(1)}%`}
                    prefix=""
                    change={computeDelta(summary.margemLiquida, previousSummary?.margemLiquida)}
                    testId="metric-margem-liquida"
                  />
                </div>

                <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
                  <MetricCard
                    title="Ticket Médio"
                    value={formatCurrency(summary.ticketMedio)}
                    prefix=""
                    testId="metric-ticket-medio"
                  />
                  <MetricCard
                    title="Vendas"
                    value={formatNumber(summary.quantidadeVendas)}
                    prefix=""
                    testId="metric-vendas"
                  />
                  <MetricCard
                    title="Despesas"
                    value={formatCurrency(summary.despesas)}
                    prefix=""
                    testId="metric-despesas"
                  />
                  <MetricCard
                    title="Saldo"
                    value={formatCurrency(summary.saldo)}
                    prefix=""
                    testId="metric-saldo"
                  />
                </div>

                <div className="grid gap-6 xl:grid-cols-3">
                  <Card className="xl:col-span-2">
                    <CardHeader>
                      <CardTitle>Faturamento vs Receita</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[320px]">
                        <canvas ref={faturamentoChartRef} />
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle>Lucro x Margem</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[320px]">
                        <canvas ref={lucroChartRef} />
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle>Evolução do Caixa</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[320px]">
                      <canvas ref={caixaChartRef} />
                    </div>
                  </CardContent>
                </Card>

                <div className="grid gap-6 lg:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle>Principais Vendas</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {insights.highlights.topVendas.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                          Nenhuma venda registrada no período selecionado.
                        </p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Venda</TableHead>
                              <TableHead>Cliente</TableHead>
                              <TableHead>Canal</TableHead>
                              <TableHead className="text-right">Valor</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {insights.highlights.topVendas.map((sale) => (
                              <TableRow key={sale.saleId}>
                                <TableCell>
                                  <div className="flex flex-col">
                                    <span className="font-medium">{sale.saleId}</span>
                                    <span className="text-xs text-muted-foreground">{sale.date}</span>
                                  </div>
                                </TableCell>
                                <TableCell>{sale.customer}</TableCell>
                                <TableCell>{sale.channel}</TableCell>
                                <TableCell className="text-right">{formatCurrency(sale.amount)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Top Custos</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {insights.highlights.topCustos.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                          Nenhuma despesa registrada no período selecionado.
                        </p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Descrição</TableHead>
                              <TableHead>Categoria</TableHead>
                              <TableHead className="text-right">Valor</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {insights.highlights.topCustos.map((cost) => (
                              <TableRow key={cost.bankTxId}>
                                <TableCell>
                                  <div className="flex flex-col">
                                    <span className="font-medium">{cost.desc}</span>
                                    <span className="text-xs text-muted-foreground">{cost.date}</span>
                                  </div>
                                </TableCell>
                                <TableCell>{cost.groupLabel || ledgerLabels[cost.group] || cost.group}</TableCell>
                                <TableCell className="text-right">{formatCurrency(cost.amount)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-6 lg:grid-cols-3">
                  <Card className="lg:col-span-2">
                    <CardHeader>
                      <CardTitle>Origem da Receita</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {insights.highlights.origemReceita.length === 0 ? (
                        <p className="text-muted-foreground text-sm">Sem canais de vendas no período.</p>
                      ) : (
                        insights.highlights.origemReceita.map((channel) => (
                          <div key={channel.channel} className="space-y-1">
                            <div className="flex items-center justify-between text-sm">
                              <span className="font-medium">{channel.channel}</span>
                              <span className="text-muted-foreground">
                                {channel.percentage.toFixed(1)}% · {formatCurrency(channel.total)}
                              </span>
                            </div>
                            <Progress value={channel.percentage} className="h-2" />
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Despesas a Categorizar</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        Lançamentos negativos sem categoria, que impactam as métricas.
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="text-sm">
                        <div className="flex items-baseline justify-between">
                          <span className="text-muted-foreground">Total pendente</span>
                          <span className="font-semibold">{formatCurrency(insights.highlights.despesasNaoCategorizadas.total)}</span>
                        </div>
                        <div className="flex items-baseline justify-between">
                          <span className="text-muted-foreground">Transações</span>
                          <span className="font-semibold">{insights.highlights.despesasNaoCategorizadas.count}</span>
                        </div>
                      </div>
                      <Separator />
                      <div className="space-y-3">
                        {insights.highlights.despesasNaoCategorizadas.items.slice(0, 5).map((item) => (
                          <div key={item.bankTxId} className="border rounded-md p-3">
                            <div className="flex justify-between text-sm">
                              <span className="font-medium">{item.desc}</span>
                              <span>{formatCurrency(item.amount)}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">{item.date}</p>
                          </div>
                        ))}
                        {insights.highlights.despesasNaoCategorizadas.count > 5 && (
                          <p className="text-xs text-muted-foreground">
                            +{insights.highlights.despesasNaoCategorizadas.count - 5} despesas adicionais aguardando categorização.
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </>
            ) : loadingInsights ? (
              <div className="text-muted-foreground">Carregando métricas...</div>
            ) : null}
          </TabsContent>

          <TabsContent value="dfc" className="space-y-6">
            {costBreakdown ? (
              <>
                <div className="grid gap-6 md:grid-cols-3">
                  <MetricCard
                    title="Entradas"
                    value={formatCurrency(costBreakdown.totals.inflows)}
                    prefix=""
                    icon={<FileBarChart className="h-6 w-6" />}
                    testId="metric-entradas"
                  />
                  <MetricCard
                    title="Saídas"
                    value={formatCurrency(costBreakdown.totals.outflows)}
                    prefix=""
                    icon={<FileBarChart className="h-6 w-6" />}
                    testId="metric-saidas"
                  />
                  <MetricCard
                    title="Fluxo Líquido"
                    value={formatCurrency(costBreakdown.totals.net)}
                    prefix=""
                    icon={<FileBarChart className="h-6 w-6" />}
                    testId="metric-fluxo-liquido"
                  />
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle>Resumo por Categoria DFC</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {costBreakdown.groups.length === 0 ? (
                      <p className="text-muted-foreground text-sm">Sem movimentações no período selecionado.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Categoria</TableHead>
                            <TableHead className="text-right">Entradas</TableHead>
                            <TableHead className="text-right">Saídas</TableHead>
                            <TableHead className="text-right">Líquido</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {costBreakdown.groups.map((group) => (
                            <TableRow key={group.key}>
                              <TableCell className="font-medium">{group.label}</TableCell>
                              <TableCell className="text-right">{formatCurrency(group.inflows)}</TableCell>
                              <TableCell className="text-right">{formatCurrency(group.outflows)}</TableCell>
                              <TableCell className="text-right">{formatCurrency(group.net)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>

                <div className="grid gap-6 lg:grid-cols-2">
                  {costBreakdown.groups.map((group) => (
                    <Card key={`group-${group.key}`}>
                      <CardHeader>
                        <CardTitle>{group.label}</CardTitle>
                        <p className="text-sm text-muted-foreground">
                          {formatCurrency(group.outflows)} em saídas · {formatCurrency(group.inflows)} em entradas
                        </p>
                      </CardHeader>
                      <CardContent>
                        {group.items.length === 0 ? (
                          <p className="text-muted-foreground text-sm">Sem lançamentos categorizados.</p>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Subcategoria</TableHead>
                                <TableHead className="text-right">Entradas</TableHead>
                                <TableHead className="text-right">Saídas</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {group.items.map((item) => (
                                <TableRow key={`${group.key}-${item.key}`}>
                                  <TableCell>{item.label}</TableCell>
                                  <TableCell className="text-right">{formatCurrency(item.inflows)}</TableCell>
                                  <TableCell className="text-right">{formatCurrency(item.outflows)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle>Despesas Sem Categoria</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Utilize a tela de conciliação e as regras inteligentes para classificar estes lançamentos.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-muted-foreground">Total pendente</span>
                      <span className="font-semibold">{formatCurrency(costBreakdown.uncategorized.total)}</span>
                    </div>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-muted-foreground">Transações</span>
                      <span className="font-semibold">{costBreakdown.uncategorized.count}</span>
                    </div>
                    <Separator />
                    {costBreakdown.uncategorized.items.length === 0 ? (
                      <p className="text-muted-foreground text-sm">Nenhuma despesa pendente.</p>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {costBreakdown.uncategorized.items.map((item) => (
                          <div key={item.bankTxId} className="border rounded-md p-3">
                            <div className="flex justify-between text-sm">
                              <span className="font-medium">{item.desc}</span>
                              <span>{formatCurrency(item.amount)}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">{item.date}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            ) : (
              <div className="text-muted-foreground">Carregando DFC...</div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function computeDelta(current?: number, previous?: number | null) {
  if (current === undefined || previous === undefined || previous === null) {
    return undefined;
  }

  return current - previous;
}

function buildSyntheticSummary(
  insights: PJMonthlyInsightsResponse,
  month: string,
): PJDashboardMonthlySummary | null {
  const index = insights.charts.faturamentoVsReceita.labels.findIndex((label) => label === month);
  if (index === -1) {
    return null;
  }

  // The helper already computes summary per month; rebuild using available series
  // If the requested month matches the current month, reuse summary directly
  if (insights.month === month) {
    return insights.summary;
  }

  // Otherwise, approximate using the historical series
  const lucroIndex = insights.charts.lucroEMargem.labels.findIndex((label) => label === month);
  const faturamento = insights.charts.faturamentoVsReceita.faturamento[index] ?? 0;
  const receita = insights.charts.faturamentoVsReceita.receita[index] ?? 0;
  const lucroLiquido = lucroIndex >= 0 ? insights.charts.lucroEMargem.lucroLiquido[lucroIndex] ?? 0 : 0;
  const margemLiquida = lucroIndex >= 0 ? insights.charts.lucroEMargem.margemLiquida[lucroIndex] ?? 0 : 0;

  return {
    ...insights.summary,
    faturamento,
    receita,
    lucroLiquido,
    margemLiquida,
    despesas: 0,
    saldo: 0,
    lucroBruto: 0,
    ticketMedio: 0,
    quantidadeVendas: 0,
    deducoesReceita: 0,
    despesasGerais: 0,
    despesasComercialMarketing: 0,
    financeiroIn: 0,
    financeiroOut: 0,
    outrasIn: 0,
    outrasOut: 0,
  };
}
