import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { FileSpreadsheet, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePJService } from "@/contexts/PJServiceContext";
import { type PJSale, type PJBankTransactionsResponse } from "@/services/pj";

interface TransacoesPJProps {
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

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("pt-BR");
}

const MONTH_OPTIONS = ["2024-03", "2024-04", "2024-05"];

export default function TransacoesPJ({ clientId, clientType, bankAccountId }: TransacoesPJProps) {
  const pjService = usePJService();
  const isPJClient = clientType === "PJ" || clientType === "BOTH";
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const latest = MONTH_OPTIONS[MONTH_OPTIONS.length - 1];
    return latest;
  });

  const monthLabel = useMemo(() => {
    const [year, month] = selectedMonth.split("-");
    return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("pt-BR", {
      month: "long",
      year: "numeric",
    });
  }, [selectedMonth]);

  const salesQuery = useQuery<{ sales: PJSale[] }>({
    queryKey: ["pj:sales", { clientId, bankAccountId, selectedMonth }],
    enabled: Boolean(clientId && bankAccountId && isPJClient),
    queryFn: () =>
      pjService.getSales({
        clientId: clientId!,
        bankAccountId: bankAccountId!,
        month: selectedMonth,
      }),
  });

  const transactionsQuery = useQuery<PJBankTransactionsResponse>({
    queryKey: ["pj:bank-transactions", { clientId, bankAccountId }],
    enabled: Boolean(clientId && bankAccountId && isPJClient),
    queryFn: () =>
      pjService.getBankTransactions({
        clientId: clientId!,
        bankAccountId: bankAccountId!,
      }),
  });

  if (!clientId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <h2 className="text-2xl font-semibold text-muted-foreground">Selecione um cliente PJ</h2>
        <p className="text-sm text-muted-foreground">
          As transações são carregadas após a escolha de um cliente com produtos PJ ativos.
        </p>
      </div>
    );
  }

  if (!isPJClient) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <h2 className="text-2xl font-semibold text-muted-foreground">Cliente sem produtos PJ</h2>
        <p className="text-sm text-muted-foreground">
          Vincule uma conta PJ para visualizar liquidações, vendas e extratos bancários.
        </p>
      </div>
    );
  }

  if (!bankAccountId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <h2 className="text-2xl font-semibold text-muted-foreground">Selecione uma conta PJ</h2>
        <p className="text-sm text-muted-foreground">
          Selecione a conta bancária desejada para acompanhar as transações conciliadas.
        </p>
      </div>
    );
  }

  const sales = salesQuery.data?.sales ?? [];
  const bankTransactions = transactionsQuery.data?.items ?? [];

  const showSalesEmpty = !sales.length && !salesQuery.isLoading && !salesQuery.isError;
  const showBankEmpty = !bankTransactions.length && !transactionsQuery.isLoading && !transactionsQuery.isError;

  return (
    <div className="space-y-6" data-testid="page-pj-transacoes">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Transações e Liquidações</h1>
          <p className="text-sm text-muted-foreground">
            Visualize as vendas liquidadas e o extrato bancário conectado ao seu ERP.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-[200px]" data-testid="select-month">
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              {MONTH_OPTIONS.map((month) => (
                <SelectItem key={month} value={month}>
                  {new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1).toLocaleDateString(
                    "pt-BR",
                    { month: "long", year: "numeric" },
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" data-testid="button-refresh" onClick={() => {
            salesQuery.refetch();
            transactionsQuery.refetch();
          }}>
            <RefreshCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {salesQuery.isError && (
        <Alert variant="destructive" data-testid="alert-sales-error">
          <AlertTitle>Erro ao carregar vendas</AlertTitle>
          <AlertDescription>
            {(salesQuery.error as Error).message || "Não foi possível carregar as vendas deste período."}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Vendas do período</CardTitle>
            <p className="text-sm text-muted-foreground">Consolidação de vendas e seus recebimentos por canal.</p>
          </div>
          <Badge variant="outline">{monthLabel}</Badge>
        </CardHeader>
        <CardContent>
          {salesQuery.isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-[90%]" />
              <Skeleton className="h-4 w-[80%]" />
              <Skeleton className="h-4 w-[75%]" />
            </div>
          )}

          {showSalesEmpty && (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
              Nenhuma venda registrada para o período selecionado.
            </div>
          )}

          {!salesQuery.isLoading && sales.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Canal</TableHead>
                  <TableHead className="text-right">Bruto</TableHead>
                  <TableHead className="text-right">Líquido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.map((sale) => (
                  <TableRow key={sale.saleId}>
                    <TableCell>{formatDate(sale.date)}</TableCell>
                    <TableCell className="font-medium">{sale.customer.name}</TableCell>
                    <TableCell>{sale.channel}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(sale.grossAmount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(sale.netAmount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {transactionsQuery.isError && (
        <Alert variant="destructive" data-testid="alert-bank-error">
          <AlertTitle>Erro ao carregar extrato bancário</AlertTitle>
          <AlertDescription>
            {(transactionsQuery.error as Error).message || "Não foi possível carregar o extrato da conta selecionada."}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Movimentações bancárias</CardTitle>
            <p className="text-sm text-muted-foreground">
              Lançamentos importados do arquivo bancário com status de conciliação.
            </p>
          </div>
          <Badge variant="secondary">{bankTransactions.length} lançamentos</Badge>
        </CardHeader>
        <CardContent>
          {transactionsQuery.isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-[92%]" />
              <Skeleton className="h-4 w-[85%]" />
            </div>
          )}

          {showBankEmpty && (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
              Nenhuma movimentação encontrada para a conta selecionada.
            </div>
          )}

          {!transactionsQuery.isLoading && bankTransactions.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bankTransactions.map((tx) => (
                  <TableRow key={tx.bankTxId}>
                    <TableCell>{formatDate(tx.date)}</TableCell>
                    <TableCell className="font-medium">{tx.desc}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(tx.amount)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={tx.reconciled ? "outline" : "secondary"}>
                        {tx.reconciled ? "Conciliado" : "Pendente"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2 font-medium text-primary">
          <FileSpreadsheet className="h-4 w-4" />
          <span>Dados mockados</span>
        </div>
        <p className="mt-2">
          As vendas e transações bancárias são fornecidas pelo serviço mockado de PJ, permitindo validar os
          estados de carregamento, erro e ausência de registros sem depender de integrações externas.
        </p>
      </div>
    </div>
  );
}
