import { useQuery } from "@tanstack/react-query";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DollarSign, TrendingUp, Percent, Upload, FileBarChart } from "lucide-react";
import { Link } from "wouter";
import type { Summary, Transaction } from "@shared/schema";

interface DashboardProps {
  clientId: string | null;
}

export default function Dashboard({ clientId }: DashboardProps) {
  const { data: summary, isLoading: loadingSummary } = useQuery<Summary>({
    queryKey: ["/api/summary", clientId],
    enabled: !!clientId,
  });

  const { data: transactionsData, isLoading: loadingTransactions } = useQuery<{ transactions: Transaction[]; summary: { totalIn: number; totalOut: number; count: number } }>({
    queryKey: ["/api/transactions/list", { clientId }],
    enabled: !!clientId,
  });
  
  const transactions = transactionsData?.transactions || [];

  if (!clientId) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <h1 className="text-2xl font-bold text-muted-foreground">
          Selecione um cliente para começar
        </h1>
        <p className="text-muted-foreground">
          Use o seletor no topo para escolher ou criar um cliente
        </p>
      </div>
    );
  }

  if (loadingSummary) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Carregando dados...</div>
      </div>
    );
  }

  const recentTransactions = transactions.slice(0, 10);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Visão geral das suas finanças</p>
      </div>

      {/* KPI Metrics */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          title="Receita Total"
          value={summary?.totalIn.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) || "0,00"}
          icon={<DollarSign className="h-8 w-8" />}
          testId="metric-receita"
        />
        <MetricCard
          title="Lucro"
          value={summary?.profit?.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) || "0,00"}
          icon={<TrendingUp className="h-8 w-8" />}
          testId="metric-lucro"
        />
        <MetricCard
          title="Margem"
          value={summary?.margin?.toFixed(1) || "0.0"}
          prefix=""
          icon={<Percent className="h-8 w-8" />}
          testId="metric-margem"
        />
      </div>

      {/* Insights */}
      {summary?.insights && summary.insights.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Insights Inteligentes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.insights.map((insight, i) => (
              <div
                key={i}
                className="flex items-start space-x-3 p-3 rounded-lg bg-muted/50"
                data-testid={`insight-${i}`}
              >
                <div className="text-primary">💡</div>
                <p className="text-sm">{insight}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Recent Transactions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Transações Recentes</CardTitle>
          <Link href="/transacoes">
            <Button variant="outline" size="sm" data-testid="button-view-all-transactions">
              Ver todas
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {loadingTransactions ? (
            <div className="text-center text-muted-foreground py-8">
              Carregando transações...
            </div>
          ) : recentTransactions.length === 0 ? (
            <div className="text-center py-8 space-y-4">
              <p className="text-muted-foreground">
                Nenhuma transação encontrada. Comece importando um arquivo CSV.
              </p>
              <Link href="/transacoes">
                <Button data-testid="button-import-csv-empty">
                  <Upload className="mr-2 h-4 w-4" />
                  Importar CSV
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {recentTransactions.map((txn, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-3 rounded-lg hover-elevate"
                  data-testid={`transaction-${i}`}
                >
                  <div className="flex-1">
                    <p className="font-medium">{txn.desc}</p>
                    <p className="text-sm text-muted-foreground">{txn.date}</p>
                  </div>
                  <div className="text-right">
                    <p className={`font-semibold tabular-nums ${
                      txn.amount > 0 
                        ? "text-green-600 dark:text-green-400" 
                        : "text-red-600 dark:text-red-400"
                    }`}>
                      {txn.amount > 0 ? "+" : ""}R$ {Math.abs(txn.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </p>
                    {txn.category && (
                      <p className="text-xs text-muted-foreground">{txn.category}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Ações Rápidas</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Link href="/transacoes">
            <Button variant="outline" className="w-full justify-start" data-testid="button-quick-import">
              <Upload className="mr-2 h-5 w-5" />
              Importar Transações
            </Button>
          </Link>
          <Link href="/relatorios">
            <Button variant="outline" className="w-full justify-start" data-testid="button-quick-report">
              <FileBarChart className="mr-2 h-5 w-5" />
              Gerar Relatório Mensal
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
