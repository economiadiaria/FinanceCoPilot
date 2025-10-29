import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MetricCard } from "@/components/metric-card";
import { DollarSign, TrendingDown, Wallet, CreditCard, BarChart3, FileBarChart } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { Link } from "wouter";
import { usePJService } from "@/contexts/PJServiceContext";
import {
  getSummary,
  type PJSummary,
  type PJTrend,
  type PJTopCostItem,
  type PJRevenueSplitItem,
  type PJSalesKpis,
} from "@/services/pj";

interface DashboardPJProps {
  clientId: string | null;
  clientType: string | null;
  bankAccountId: string | null;
}

export default function DashboardPJ({ clientId, clientType, bankAccountId }: DashboardPJProps) {
  const pjService = usePJService();
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  
  const [year, setYear] = useState(() => new Date().getFullYear().toString());

  const trendsChartRef = useRef<HTMLCanvasElement>(null);
  const revenueChartRef = useRef<HTMLCanvasElement>(null);
  const costsChartRef = useRef<HTMLCanvasElement>(null);

  const isPJClient = clientType === "PJ" || clientType === "BOTH";

  const getMonthRange = () => {
    const [yearPart, monthPart] = month.split("-");
    const yearNum = Number(yearPart);
    const monthNum = Number(monthPart) - 1;
    const fromDate = new Date(Date.UTC(yearNum, monthNum, 1));
    const toDate = new Date(Date.UTC(yearNum, monthNum + 1, 0));
    return {
      from: fromDate.toISOString().split("T")[0],
      to: toDate.toISOString().split("T")[0],
    };
  };

  const { data: summary, isLoading: loadingSummary, error: errorSummary } = useQuery<PJSummary>({
    queryKey: ["/api/pj/dashboard/summary", { clientId, month, bankAccountId }],
    enabled: !!clientId && !!bankAccountId && isPJClient,
    queryFn: () => {
      const { from, to } = getMonthRange();
      return getSummary({
        clientId: clientId!,
        bankAccountId: bankAccountId!,
        from,
        to,
      });
    },
  });

  const { data: trendsData, error: errorTrends } = useQuery<{ trends: PJTrend[] }>({
    queryKey: ["/api/pj/dashboard/trends", { clientId, year, bankAccountId }],
    enabled: !!clientId && !!bankAccountId && isPJClient,
    queryFn: () =>
      pjService.getTrends({
        clientId: clientId!,
        bankAccountId: bankAccountId!,
        year,
      }),
  });

  const { data: revenueSplitData, error: errorRevenue } = useQuery<{
    revenueSplit: PJRevenueSplitItem[];
  }>({
    queryKey: ["/api/pj/dashboard/revenue-split", { clientId, month, bankAccountId }],
    enabled: !!clientId && !!bankAccountId && isPJClient,
    queryFn: () =>
      pjService.getRevenueSplit({
        clientId: clientId!,
        bankAccountId: bankAccountId!,
        month,
      }),
  });

  const { data: topCostsData, error: errorCosts } = useQuery<{ topCosts: PJTopCostItem[] }>({
    queryKey: ["/api/pj/dashboard/top-costs", { clientId, month, bankAccountId }],
    enabled: !!clientId && !!bankAccountId && isPJClient,
    queryFn: () =>
      pjService.getTopCosts({
        clientId: clientId!,
        bankAccountId: bankAccountId!,
        month,
      }),
  });

  const { data: salesKPIs, error: errorKPIs } = useQuery<PJSalesKpis>({
    queryKey: ["/api/pj/dashboard/sales-kpis", { clientId, month, bankAccountId }],
    enabled: !!clientId && !!bankAccountId && isPJClient,
    queryFn: () =>
      pjService.getSalesKpis({
        clientId: clientId!,
        bankAccountId: bankAccountId!,
        month,
      }),
  });

  // Chart.js rendering
  useEffect(() => {
    if (!trendsData?.trends || !trendsChartRef.current) return;

    const Chart = (window as any).Chart;
    if (!Chart) return;

    const ctx = trendsChartRef.current.getContext("2d");
    if (!ctx) return;

    const chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: trendsData.trends.map(t => t.month),
        datasets: [
          {
            label: "Receitas",
            data: trendsData.trends.map(t => t.receitas),
            borderColor: "rgb(34, 197, 94)",
            backgroundColor: "rgba(34, 197, 94, 0.1)",
            tension: 0.4,
          },
          {
            label: "Despesas",
            data: trendsData.trends.map(t => t.despesas),
            borderColor: "rgb(239, 68, 68)",
            backgroundColor: "rgba(239, 68, 68, 0.1)",
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

    return () => chart.destroy();
  }, [trendsData]);

  useEffect(() => {
    if (!revenueSplitData?.revenueSplit || !revenueChartRef.current) return;

    const Chart = (window as any).Chart;
    if (!Chart) return;

    const ctx = revenueChartRef.current.getContext("2d");
    if (!ctx) return;

    const chart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: revenueSplitData.revenueSplit.map(r => r.channel),
        datasets: [
          {
            data: revenueSplitData.revenueSplit.map(r => r.amount),
            backgroundColor: [
              "rgb(59, 130, 246)",
              "rgb(34, 197, 94)",
              "rgb(251, 146, 60)",
              "rgb(168, 85, 247)",
              "rgb(236, 72, 153)",
            ],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "right" },
        },
      },
    });

    return () => chart.destroy();
  }, [revenueSplitData]);

  useEffect(() => {
    if (!topCostsData?.topCosts || !costsChartRef.current) return;

    const Chart = (window as any).Chart;
    if (!Chart) return;

    const ctx = costsChartRef.current.getContext("2d");
    if (!ctx) return;

    const chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: topCostsData.topCosts.map(c => c.item),
        datasets: [
          {
            label: "Valor (R$)",
            data: topCostsData.topCosts.map(c => c.total),
            backgroundColor: "rgb(239, 68, 68)",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "y",
        plugins: {
          legend: { display: false },
        },
      },
    });

    return () => chart.destroy();
  }, [topCostsData]);

  if (!clientId) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <h1 className="text-2xl font-bold text-muted-foreground">
          Selecione um cliente PJ para começar
        </h1>
        <p className="text-muted-foreground">
          Use o seletor no topo para escolher ou criar um cliente PJ
        </p>
      </div>
    );
  }

  if (!isPJClient) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <BarChart3 className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-2xl font-bold text-muted-foreground">
          Esta funcionalidade é exclusiva para clientes PJ
        </h1>
        <p className="text-muted-foreground">
          Selecione um cliente do tipo Pessoa Jurídica para acessar o dashboard empresarial
        </p>
      </div>
    );
  }

  if (!bankAccountId) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <CreditCard className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-2xl font-bold text-muted-foreground">Selecione uma conta PJ</h1>
        <p className="text-muted-foreground">
          Use o seletor de contas bancárias para visualizar os dados do dashboard.
        </p>
      </div>
    );
  }

  if (loadingSummary) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Carregando dashboard PJ...</div>
      </div>
    );
  }

  if (errorSummary || errorTrends || errorRevenue || errorCosts || errorKPIs) {
    const error = errorSummary || errorTrends || errorRevenue || errorCosts || errorKPIs;
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-destructive">
          Erro ao carregar dashboard: {(error as Error).message}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-dashboard-title">Dashboard PJ</h1>
          <p className="text-muted-foreground">Visão geral do negócio</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-40"
            data-testid="input-month"
          />
          <select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="flex h-9 w-32 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            data-testid="select-year"
          >
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI Metrics - Financeiro */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Receitas"
          value={(summary?.receitas || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          icon={<DollarSign className="h-8 w-8" />}
          testId="metric-receitas"
        />
        <MetricCard
          title="Despesas"
          value={(summary?.despesas || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          icon={<TrendingDown className="h-8 w-8" />}
          testId="metric-despesas"
        />
        <MetricCard
          title="Saldo"
          value={(summary?.saldo || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          icon={<Wallet className="h-8 w-8" />}
          testId="metric-saldo"
        />
        <MetricCard
          title="Contas a Receber"
          value={(summary?.contasReceber || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          icon={<CreditCard className="h-8 w-8" />}
          testId="metric-contas-receber"
        />
      </div>

      {/* KPI Metrics - Lucro e Margem */}
      <div className="grid gap-6 md:grid-cols-3">
        <MetricCard
          title="Lucro Bruto"
          value={(summary?.lucroBruto || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          icon={<DollarSign className="h-8 w-8" />}
          testId="metric-lucro-bruto"
        />
        <MetricCard
          title="Lucro Líquido"
          value={(summary?.lucroLiquido || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          icon={<Wallet className="h-8 w-8" />}
          testId="metric-lucro-liquido"
        />
        <MetricCard
          title="Margem Líquida"
          value={`${(summary?.margemLiquida || 0).toFixed(1)}%`}
          icon={<BarChart3 className="h-8 w-8" />}
          testId="metric-margem-liquida"
        />
      </div>

      {/* Charts Row 1 */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Tendências ({year})</CardTitle>
          </CardHeader>
          <CardContent>
            <div style={{ height: "300px" }}>
              <canvas ref={trendsChartRef} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Distribuição de Receita</CardTitle>
          </CardHeader>
          <CardContent>
            <div style={{ height: "300px" }}>
              <canvas ref={revenueChartRef} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top 10 Custos</CardTitle>
          </CardHeader>
          <CardContent>
            <div style={{ height: "400px" }}>
              <canvas ref={costsChartRef} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>KPIs de Vendas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Total de Vendas</p>
                <p className="text-2xl font-bold tabular-nums" data-testid="text-total-sales">
                  {salesKPIs?.totalSales || 0}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Receita Total</p>
                <p className="text-2xl font-bold tabular-nums" data-testid="text-total-revenue">
                  {(salesKPIs?.totalRevenue || 0).toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                </p>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Ticket Médio</p>
              <p className="text-2xl font-bold tabular-nums" data-testid="text-ticket-medio">
                {(salesKPIs?.ticketMedio || 0).toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}
              </p>
            </div>

            {salesKPIs?.topClientes && salesKPIs.topClientes.length > 0 && (
              <div className="space-y-2 pt-4">
                <p className="text-sm font-semibold">Top 5 Clientes</p>
                <div className="space-y-2">
                  {salesKPIs.topClientes.map((cliente, i) => (
                    <div
                      key={i}
                      className="flex justify-between items-center p-2 rounded bg-muted/50"
                      data-testid={`top-cliente-${i}`}
                    >
                      <span className="text-sm font-medium">{cliente.customer}</span>
                      <span className="text-sm tabular-nums">
                        {cliente.amount.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Ações Rápidas</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Link href="/pj/resumo">
            <Button variant="outline" data-testid="button-nav-resumo">
              <BarChart3 className="mr-2 h-4 w-4" />
              Resumo Financeiro
            </Button>
          </Link>
          <Link href="/pj/transacoes">
            <Button variant="outline" data-testid="button-nav-transacoes">
              <Wallet className="mr-2 h-4 w-4" />
              Transações e Liquidações
            </Button>
          </Link>
          <Link href="/pj/relatorios">
            <Button variant="outline" data-testid="button-nav-relatorios">
              <FileBarChart className="mr-2 h-4 w-4" />
              Relatórios Analíticos
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
