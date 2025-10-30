import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { FileSpreadsheet, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePJService } from "@/contexts/PJServiceContext";
import { usePJFilters } from "@/contexts/PJFiltersContext";
import { usePJBankAccounts } from "@/hooks/usePJBankAccounts";
import { formatRangeLabel, toApiDateRange } from "@/lib/date-range";
import { useRequestIdToasts } from "@/hooks/useRequestIdToasts";
import { formatRequestId } from "@/lib/requestId";
import {
  type PJSale,
  type PJBankTransactionsResponse,
  type PJPeriodParams,
  type PJTransactionsParams,
} from "@/services/pj";

interface TransacoesPJProps {
  clientType: string | null;
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

function getRequestId(value: unknown): string | null {
  if (value && typeof value === "object" && "requestId" in value) {
    const casted = value as { requestId?: string | null };
    return casted.requestId ?? null;
  }
  return null;
}

function aggregateSummaries(summaries: PJSale[][]): PJSale[] {
  return summaries.flat();
}

function aggregateTransactions(responses: PJBankTransactionsResponse[]): PJBankTransactionsResponse {
  const items = responses.flatMap((response) => response.items);
  items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return {
    items,
    pagination: {
      page: 1,
      limit: items.length,
      totalItems: items.length,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  };
}

export default function TransacoesPJ({ clientType }: TransacoesPJProps) {
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

  const salesQuery = useQuery({
    queryKey: [
      "pj:sales",
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
        return { sales: [] as PJSale[], requestIds: [] as string[] };
      }

      const fromDate = from;
      const toDate = to;

      if (isAllAccounts) {
        const responses = await Promise.all(
          availableAccounts.map((account) => {
            const params: PJPeriodParams = {
              clientId,
              bankAccountId: account.id,
              from: fromDate,
              to: toDate,
            };
            return pjService.getSales(params);
          }),
        );

        const sales = aggregateSummaries(responses.map((response) => response.sales));
        const requestIds = responses
          .map((response) => getRequestId(response))
          .filter((id): id is string => Boolean(id));

        return { sales, requestIds };
      }

      const params: PJPeriodParams = {
        clientId,
        bankAccountId: selectedAccountId!,
        from: fromDate,
        to: toDate,
      };
      const response = await pjService.getSales(params);

      const requestIds = [getRequestId(response)].filter((id): id is string => Boolean(id));
      return { sales: response.sales, requestIds };
    },
  });

  const transactionsQuery = useQuery({
    queryKey: [
      "pj:bank-transactions",
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
        return { response: { items: [], pagination: { page: 1, limit: 0, totalItems: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false } }, requestIds: [] as string[] };
      }

      const fromDate = from;
      const toDate = to;

      if (isAllAccounts) {
        const responses = await Promise.all(
          availableAccounts.map((account) => {
            const txnParams: PJTransactionsParams = {
              clientId,
              bankAccountId: account.id,
              from: fromDate,
              to: toDate,
            };
            return pjService.getBankTransactions(txnParams);
          }),
        );

        const response = aggregateTransactions(responses);
        const requestIds = responses
          .map((value) => getRequestId(value))
          .filter((id): id is string => Boolean(id));

        return { response, requestIds };
      }

      const txnParams: PJTransactionsParams = {
        clientId,
        bankAccountId: selectedAccountId!,
        from: fromDate,
        to: toDate,
      };
      const response = await pjService.getBankTransactions(txnParams);

      const requestIds = [getRequestId(response)].filter((id): id is string => Boolean(id));
      return { response, requestIds };
    },
  });

  const sales = salesQuery.data?.sales ?? [];
  const bankTransactions = transactionsQuery.data?.response.items ?? [];

  const uniqueRequestIds = useMemo(() => {
    const ids = [
      ...(salesQuery.data?.requestIds ?? []),
      ...(transactionsQuery.data?.requestIds ?? []),
    ];
    return Array.from(new Set(ids));
  }, [salesQuery.data?.requestIds, transactionsQuery.data?.requestIds]);

  useRequestIdToasts(uniqueRequestIds, { context: "Transações PJ" });

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

  if (!selectedAccountId && !isLoadingAccounts) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <h2 className="text-2xl font-semibold text-muted-foreground">Selecione uma conta PJ</h2>
        <p className="text-sm text-muted-foreground">
          Selecione a conta bancária desejada para acompanhar as transações conciliadas.
        </p>
      </div>
    );
  }

  const showSalesEmpty = !sales.length && !salesQuery.isLoading && !salesQuery.isError;
  const showBankEmpty =
    !bankTransactions.length && !transactionsQuery.isLoading && !transactionsQuery.isError;

  return (
    <div className="space-y-6" data-testid="page-pj-transacoes">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Transações e Liquidações</h1>
            <p className="text-sm text-muted-foreground">
              Visualize as vendas liquidadas e o extrato bancário conectado ao seu ERP.
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
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            data-testid="button-refresh"
            onClick={() => {
              salesQuery.refetch();
              transactionsQuery.refetch();
            }}
            disabled={!canQuery}
          >
            <RefreshCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {salesQuery.isError && (
        <Alert variant="destructive" data-testid="alert-sales-error">
          <AlertTitle>Erro ao carregar vendas</AlertTitle>
          <AlertDescription>
            {(salesQuery.error as Error).message ||
              "Não foi possível carregar as vendas deste período."}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Vendas do período</CardTitle>
            <p className="text-sm text-muted-foreground">
              Consolidação de vendas e seus recebimentos por canal.
            </p>
          </div>
          <Badge variant="outline">{sales.length} registros</Badge>
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
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(sale.grossAmount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(sale.netAmount)}
                    </TableCell>
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
            {(transactionsQuery.error as Error).message ||
              "Não foi possível carregar o extrato da conta selecionada."}
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
          As vendas e transações bancárias são fornecidas pelo serviço mockado de PJ, permitindo validar os estados de
          carregamento, erro e ausência de registros sem depender de integrações externas.
        </p>
      </div>
    </div>
  );
}
