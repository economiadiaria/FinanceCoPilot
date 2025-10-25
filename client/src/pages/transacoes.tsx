import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { FileText, ArrowUpDown, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Transaction } from "@shared/schema";
import { transactionCategories } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getApiKey } from "@/lib/api";
import { formatToBR, getCurrentPeriod, getPeriodRange } from "@/lib/dateUtils";

interface TransacoesProps {
  clientId: string | null;
}

interface TransactionsResponse {
  transactions: Transaction[];
  summary: {
    totalIn: number;
    totalOut: number;
    count: number;
  };
}

export default function Transacoes({ clientId }: TransacoesProps) {
  const { toast } = useToast();
  const ofxInputRef = useRef<HTMLInputElement>(null);
  const [selectedFitIds, setSelectedFitIds] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchText, setSearchText] = useState<string>("");
  const [sortColumn, setSortColumn] = useState<"date" | "desc" | "amount" | "bankName" | null>("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  
  // Default to current month period
  const currentPeriod = getCurrentPeriod();
  const { from: defaultFrom, to: defaultTo } = getPeriodRange(currentPeriod);
  const [periodFrom, setPeriodFrom] = useState<string>(defaultFrom);
  const [periodTo, setPeriodTo] = useState<string>(defaultTo);

  const { data, isLoading } = useQuery<TransactionsResponse>({
    queryKey: [
      "/api/transactions/list", 
      { 
        clientId, 
        status: statusFilter === "all" ? undefined : statusFilter, 
        category: categoryFilter === "all" ? undefined : categoryFilter,
        from: periodFrom,
        to: periodTo
      }
    ],
    enabled: !!clientId,
  });

  const allTransactions = data?.transactions || [];
  const summary = data?.summary;
  
  // Apply local search filter
  let transactions = allTransactions.filter(txn => 
    txn.desc.toLowerCase().includes(searchText.toLowerCase())
  );
  
  // Apply sorting
  if (sortColumn) {
    transactions = [...transactions].sort((a, b) => {
      let comparison = 0;
      
      if (sortColumn === "date") {
        comparison = a.date.localeCompare(b.date);
      } else if (sortColumn === "desc") {
        comparison = a.desc.localeCompare(b.desc);
      } else if (sortColumn === "amount") {
        comparison = a.amount - b.amount;
      } else if (sortColumn === "bankName") {
        comparison = (a.bankName || "").localeCompare(b.bankName || "");
      }
      
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }

  const importOfxMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("ofx", file);
      formData.append("clientId", clientId!);

      const response = await fetch("/api/import/ofx", {
        method: "POST",
        headers: {
          "X-API-KEY": getApiKey(),
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Erro ao importar OFX");
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions/list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/summary"] });
      toast({
        title: "Importação OFX concluída",
        description: data.message || `${data.imported} transações importadas.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Erro na importação OFX",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const categorizeMutation = useMutation({
    mutationFn: async ({ fitIds, category }: { fitIds: string[]; category: string }) => {
      // Convert fitIds back to indices in the original transaction list
      const allTxns = allTransactions;
      const indices = fitIds
        .map(fitId => allTxns.findIndex(t => t.fitid === fitId))
        .filter(idx => idx !== -1);
      
      return apiRequest("POST", "/api/transactions/categorize", {
        clientId,
        indices,
        category,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions/list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/summary"] });
      setSelectedFitIds(new Set());
      toast({
        title: "Categorização concluída",
        description: `${selectedFitIds.size} transação(ões) categorizada(s)!`,
      });
    },
  });

  const handleOfxUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    importOfxMutation.mutate(file);
  };

  const handleCategorize = (category: string) => {
    if (selectedFitIds.size === 0) {
      toast({
        title: "Nenhuma transação selecionada",
        description: "Selecione ao menos uma transação para categorizar.",
        variant: "destructive",
      });
      return;
    }
    categorizeMutation.mutate({ fitIds: Array.from(selectedFitIds), category });
  };

  const toggleSelection = (fitId: string | undefined) => {
    if (!fitId) return;
    setSelectedFitIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(fitId)) {
        newSet.delete(fitId);
      } else {
        newSet.add(fitId);
      }
      return newSet;
    });
  };

  const toggleAll = () => {
    if (selectedFitIds.size === transactions.length) {
      setSelectedFitIds(new Set());
    } else {
      const allFitIds = transactions.map(t => t.fitid).filter((id): id is string => !!id);
      setSelectedFitIds(new Set(allFitIds));
    }
  };
  
  const handleSort = (column: "date" | "desc" | "amount" | "bankName") => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const handleExportCSV = () => {
    if (transactions.length === 0) {
      toast({
        title: "Nenhuma transação para exportar",
        description: "Não há transações visíveis com os filtros atuais.",
        variant: "destructive",
      });
      return;
    }

    // Helper to escape and quote CSV cells
    const escapeCSV = (value: string | number) => {
      const str = String(value);
      return `"${str.replace(/"/g, '""')}"`;
    };

    // CSV header
    const headers = ["Data", "Descrição", "Valor", "Categoria", "Status", "Banco"];
    
    // CSV rows - all values quoted for safety
    const rows = transactions.map(txn => [
      escapeCSV(formatToBR(txn.date)),
      escapeCSV(txn.desc),
      escapeCSV(txn.amount.toFixed(2)),
      escapeCSV(txn.category || "Pendente"),
      escapeCSV(txn.status || "pendente"),
      escapeCSV(txn.bankName || "N/A")
    ]);

    // Combine header and rows
    const csvContent = [
      headers.map(h => escapeCSV(h)).join(","),
      ...rows.map(row => row.join(","))
    ].join("\n");

    // Create download
    const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" }); // BOM for Excel
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `transacoes_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Clean up blob URL
    URL.revokeObjectURL(url);

    toast({
      title: "CSV exportado",
      description: `${transactions.length} transação(ões) exportada(s) com sucesso!`,
    });
  };

  if (!clientId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Selecione um cliente para visualizar transações</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Transações</h1>
          <p className="text-muted-foreground">Gerencie e categorize suas transações</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleExportCSV}
            disabled={!transactions || transactions.length === 0}
            data-testid="button-export-csv"
          >
            <Download className="mr-2 h-4 w-4" />
            Exportar CSV
          </Button>
          <Button
            onClick={() => ofxInputRef.current?.click()}
            disabled={importOfxMutation.isPending}
            data-testid="button-import-ofx"
          >
            <FileText className="mr-2 h-4 w-4" />
            {importOfxMutation.isPending ? "Importando..." : "Importar OFX"}
          </Button>
          <input
            ref={ofxInputRef}
            type="file"
            accept=".ofx"
            className="hidden"
            onChange={handleOfxUpload}
            data-testid="input-file-ofx"
          />
        </div>
      </div>

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm font-medium text-muted-foreground">Entradas</div>
              <div className="text-2xl font-bold text-green-600 dark:text-green-500 tabular-nums">
                R$ {summary.totalIn.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm font-medium text-muted-foreground">Saídas</div>
              <div className="text-2xl font-bold text-red-600 dark:text-red-500 tabular-nums">
                R$ {summary.totalOut.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm font-medium text-muted-foreground">Total de Transações</div>
              <div className="text-2xl font-bold tabular-nums">
                {summary.count}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="flex-1">
            <Label>Data Início</Label>
            <Input
              type="date"
              value={periodFrom}
              onChange={(e) => setPeriodFrom(e.target.value)}
              data-testid="input-date-from"
            />
          </div>
          <div className="flex-1">
            <Label>Data Fim</Label>
            <Input
              type="date"
              value={periodTo}
              onChange={(e) => setPeriodTo(e.target.value)}
              data-testid="input-date-to"
            />
          </div>
          <div className="flex-1">
            <Label>Buscar Descrição</Label>
            <Input
              placeholder="Ex: uber, ifood..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              data-testid="input-search-description"
            />
          </div>
          <div className="flex-1">
            <Label>Categoria</Label>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger data-testid="select-category-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {transactionCategories.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1">
            <Label>Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger data-testid="select-status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="pendente">Pendente</SelectItem>
                <SelectItem value="categorizada">Categorizada</SelectItem>
                <SelectItem value="revisar">Revisar</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Actions */}
      {selectedFitIds.size > 0 && (() => {
        // Get selected transactions to determine what buttons to show
        const selectedTxns = allTransactions.filter(t => selectedFitIds.has(t.fitid || ""));
        const hasInflows = selectedTxns.some(t => t.amount >= 0);
        const hasOutflows = selectedTxns.some(t => t.amount < 0);
        const isMixed = hasInflows && hasOutflows;
        
        return (
          <Card className="border-primary">
            <CardContent className="py-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <span className="font-medium">
                    {selectedFitIds.size} transação(ões) selecionada(s)
                  </span>
                  {isMixed && (
                    <p className="text-sm text-muted-foreground mt-1">
                      Mistura de entradas e saídas selecionadas
                    </p>
                  )}
                </div>
                <div className="flex gap-2 flex-wrap">
                  {hasInflows && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCategorize("Receita")}
                      disabled={categorizeMutation.isPending}
                      data-testid="button-categorize-receita"
                      className="bg-green-50 dark:bg-green-950 border-green-300 dark:border-green-800"
                    >
                      ✓ Receita
                    </Button>
                  )}
                  {hasOutflows && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCategorize("Fixo")}
                        disabled={categorizeMutation.isPending}
                        data-testid="button-categorize-fixo"
                        className="bg-red-50 dark:bg-red-950 border-red-300 dark:border-red-800"
                      >
                        Custo Fixo
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCategorize("Variável")}
                        disabled={categorizeMutation.isPending}
                        data-testid="button-categorize-variavel"
                        className="bg-orange-50 dark:bg-orange-950 border-orange-300 dark:border-orange-800"
                      >
                        Custo Variável
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Transaction Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">
              Carregando transações...
            </div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-12 space-y-4">
              <p className="text-muted-foreground">
                Nenhuma transação encontrada. Importe um arquivo OFX do seu banco para começar.
              </p>
              <p className="text-sm text-muted-foreground">
                Clique em "Importar OFX" acima para enviar seu extrato bancário
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="w-12 p-4">
                      <Checkbox
                        checked={selectedFitIds.size === transactions.length && transactions.length > 0}
                        onCheckedChange={toggleAll}
                        data-testid="checkbox-select-all"
                      />
                    </th>
                    <th className="text-left p-4 text-sm font-medium w-32">
                      <button
                        onClick={() => handleSort("date")}
                        className="flex items-center gap-1 hover-elevate rounded px-2 py-1"
                        data-testid="button-sort-date"
                      >
                        Data
                        <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </th>
                    <th className="text-left p-4 text-sm font-medium flex-1">
                      <button
                        onClick={() => handleSort("desc")}
                        className="flex items-center gap-1 hover-elevate rounded px-2 py-1"
                        data-testid="button-sort-desc"
                      >
                        Descrição
                        <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </th>
                    <th className="text-left p-4 text-sm font-medium w-40">
                      <button
                        onClick={() => handleSort("bankName")}
                        className="flex items-center gap-1 hover-elevate rounded px-2 py-1"
                        data-testid="button-sort-bank"
                      >
                        Banco
                        <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </th>
                    <th className="text-left p-4 text-sm font-medium w-40">Categoria</th>
                    <th className="text-right p-4 text-sm font-medium w-32">
                      <button
                        onClick={() => handleSort("amount")}
                        className="flex items-center gap-1 hover-elevate rounded px-2 py-1 ml-auto"
                        data-testid="button-sort-amount"
                      >
                        Valor
                        <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((txn, index) => (
                    <tr
                      key={index}
                      className="border-t h-14 hover-elevate"
                      data-testid={`transaction-row-${index}`}
                    >
                      <td className="p-4">
                        <Checkbox
                          checked={selectedFitIds.has(txn.fitid || "")}
                          onCheckedChange={() => toggleSelection(txn.fitid)}
                          data-testid={`checkbox-transaction-${index}`}
                        />
                      </td>
                      <td className="p-4 text-sm">{formatToBR(txn.date)}</td>
                      <td className="p-4">{txn.desc}</td>
                      <td className="p-4 text-sm text-muted-foreground">{txn.bankName || '-'}</td>
                      <td className="p-4">
                        {txn.category ? (
                          <Badge variant="secondary">{txn.category}</Badge>
                        ) : (
                          <Badge variant="outline">Pendente</Badge>
                        )}
                      </td>
                      <td className={`p-4 text-right font-semibold tabular-nums ${
                        txn.amount > 0
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      }`}>
                        {txn.amount > 0 ? "+" : ""}R$ {Math.abs(txn.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
