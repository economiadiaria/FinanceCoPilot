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
import { FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Transaction } from "@shared/schema";
import { transactionCategories } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getApiKey } from "@/lib/api";

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
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data, isLoading } = useQuery<TransactionsResponse>({
    queryKey: ["/api/transactions/list", { clientId, status: statusFilter === "all" ? undefined : statusFilter, category: categoryFilter === "all" ? undefined : categoryFilter }],
    enabled: !!clientId,
  });

  const transactions = data?.transactions || [];
  const summary = data?.summary;

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
    mutationFn: async ({ indices, category }: { indices: number[]; category: string }) => {
      return apiRequest("POST", "/api/transactions/categorize", {
        clientId,
        indices,
        category,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions/list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/summary"] });
      setSelectedIndices([]);
      toast({
        title: "Categorização concluída",
        description: `${selectedIndices.length} transação(ões) categorizada(s)!`,
      });
    },
  });

  const handleOfxUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    importOfxMutation.mutate(file);
  };

  const handleCategorize = (category: string) => {
    if (selectedIndices.length === 0) {
      toast({
        title: "Nenhuma transação selecionada",
        description: "Selecione ao menos uma transação para categorizar.",
        variant: "destructive",
      });
      return;
    }
    categorizeMutation.mutate({ indices: selectedIndices, category });
  };

  const toggleSelection = (index: number) => {
    setSelectedIndices((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    );
  };

  const toggleAll = () => {
    if (selectedIndices.length === transactions.length) {
      setSelectedIndices([]);
    } else {
      setSelectedIndices(transactions.map((_, i) => i));
    }
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
        <CardContent className="flex gap-4">
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
      {selectedIndices.length > 0 && (
        <Card className="border-primary">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {selectedIndices.length} transação(ões) selecionada(s)
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCategorize("Receita")}
                  disabled={categorizeMutation.isPending}
                  data-testid="button-categorize-receita"
                >
                  Receita
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCategorize("Custo Fixo")}
                  disabled={categorizeMutation.isPending}
                  data-testid="button-categorize-custo-fixo"
                >
                  Custo Fixo
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCategorize("Custo Variável")}
                  disabled={categorizeMutation.isPending}
                  data-testid="button-categorize-custo-variavel"
                >
                  Custo Variável
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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
                        checked={selectedIndices.length === transactions.length}
                        onCheckedChange={toggleAll}
                        data-testid="checkbox-select-all"
                      />
                    </th>
                    <th className="text-left p-4 text-sm font-medium w-32">Data</th>
                    <th className="text-left p-4 text-sm font-medium flex-1">Descrição</th>
                    <th className="text-left p-4 text-sm font-medium w-40">Categoria</th>
                    <th className="text-right p-4 text-sm font-medium w-32">Valor</th>
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
                          checked={selectedIndices.includes(index)}
                          onCheckedChange={() => toggleSelection(index)}
                          data-testid={`checkbox-transaction-${index}`}
                        />
                      </td>
                      <td className="p-4 text-sm">{txn.date}</td>
                      <td className="p-4">{txn.desc}</td>
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
