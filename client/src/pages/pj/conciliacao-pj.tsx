import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Upload, CheckCircle, AlertCircle } from "lucide-react";
import { useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConciliacaoPJProps {
  clientId: string | null;
  clientType: string | null;
  bankAccountId: string | null;
}

interface SaleLeg {
  saleLegId: string;
  saleId: string;
  paymentMethod: string;
  grossAmount: number;
  netAmount: number;
  settlementPlan: {
    n: number;
    due: string;
    expected: number;
    receivedTxId?: string;
    receivedAt?: string;
  }[];
  reconciliation: {
    state: string;
  };
}

interface BankTransaction {
  bankTxId: string;
  date: string;
  desc: string;
  amount: number;
  reconciled: boolean;
}

interface BankTransactionsResponse {
  items: BankTransaction[];
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

interface Suggestion {
  parcelN: number;
  bankTxId: string;
  date: string;
  amount: number;
  desc: string;
  score: number;
  matchReason: string;
}

export default function ConciliacaoPJ({ clientId, clientType, bankAccountId }: ConciliacaoPJProps) {
  const { toast } = useToast();
  const ofxInputRef = useRef<HTMLInputElement>(null);
  const [selectedLeg, setSelectedLeg] = useState<SaleLeg | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const isPJClient = clientType === "PJ" || clientType === "BOTH";

  const { data: legsData, isLoading: loadingLegs, error: errorLegs } = useQuery<{ legs: SaleLeg[] }>({
    queryKey: ["/api/pj/sales/legs", { clientId, bankAccountId }],
    enabled: !!clientId && !!bankAccountId && isPJClient,
  });

  const { data: bankTxsData, isLoading: loadingTxs, error: errorTxs } = useQuery<BankTransactionsResponse>({
    queryKey: ["/api/pj/transactions", { clientId, bankAccountId }],
    enabled: !!clientId && !!bankAccountId && isPJClient,
  });

  const uploadOfxMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("ofx", file);
      formData.append("clientId", clientId!);
      formData.append("bankAccountId", bankAccountId!);

      const res = await fetch("/api/pj/import/ofx", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }

      return await res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "OFX importado com sucesso",
        description: `${data.imported} transações bancárias importadas`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/pj/transactions"] });
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao importar OFX",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const suggestMutation = useMutation({
    mutationFn: async (saleLegId: string) => {
      const res = await apiRequest("POST", "/api/pj/reconciliation/suggest", {
        clientId,
        bankAccountId,
        saleLegId,
      });
      return await res.json();
    },
    onSuccess: (data: any) => {
      setSuggestions(data.suggestions || []);
      setShowSuggestions(true);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async ({ saleLegId, matches }: any) => {
      const res = await apiRequest("POST", "/api/pj/reconciliation/confirm", {
        clientId,
        bankAccountId,
        saleLegId,
        matches,
      });
      return await res.json();
    },
    onSuccess: () => {
      toast({
        title: "Conciliação confirmada",
        description: "Parcelas conciliadas com sucesso",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/pj/sales/legs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pj/transactions"] });
      setShowSuggestions(false);
      setSelectedLeg(null);
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao confirmar conciliação",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleOfxUpload = () => {
    ofxInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadOfxMutation.mutate(file);
    }
  };

  const handleSuggest = (leg: SaleLeg) => {
    setSelectedLeg(leg);
    suggestMutation.mutate(leg.saleLegId);
  };

  const handleConfirm = (suggestion: Suggestion) => {
    if (!selectedLeg) return;

    confirmMutation.mutate({
      saleLegId: selectedLeg.saleLegId,
      matches: [{ parcelN: suggestion.parcelN, bankTxId: suggestion.bankTxId }],
    });
  };

  if (!clientId) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <h1 className="text-2xl font-bold text-muted-foreground">
          Selecione um cliente PJ
        </h1>
      </div>
    );
  }

  if (!isPJClient) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <AlertCircle className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-2xl font-bold text-muted-foreground">
          Esta funcionalidade é exclusiva para clientes PJ
        </h1>
        <p className="text-muted-foreground">
          Selecione um cliente do tipo Pessoa Jurídica para acessar a conciliação bancária
        </p>
      </div>
    );
  }

  if (!bankAccountId) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <AlertCircle className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-2xl font-bold text-muted-foreground">Selecione uma conta PJ</h1>
        <p className="text-muted-foreground">
          Use o seletor de contas bancárias para iniciar a conciliação.
        </p>
      </div>
    );
  }

  if (loadingLegs || loadingTxs) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Carregando dados de conciliação...</div>
      </div>
    );
  }

  if (errorLegs || errorTxs) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-destructive">
          Erro ao carregar dados: {((errorLegs || errorTxs) as Error).message}
        </div>
      </div>
    );
  }

  const legs = legsData?.legs || [];
  const bankTxs = bankTxsData?.items || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-conciliacao-title">
            Conciliação Bancária
          </h1>
          <p className="text-muted-foreground">Concilie vendas com extratos bancários</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleOfxUpload}
            disabled={uploadOfxMutation.isPending}
            data-testid="button-import-ofx"
          >
            <Upload className="mr-2 h-4 w-4" />
            {uploadOfxMutation.isPending ? "Importando..." : "Importar OFX"}
          </Button>
          <input
            ref={ofxInputRef}
            type="file"
            accept=".ofx"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Transações Bancárias</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tabular-nums" data-testid="text-bank-txs-count">
              {bankTxs.length}
            </div>
            <p className="text-sm text-muted-foreground">
              {bankTxs.filter(tx => !tx.reconciled).length} não conciliadas
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Legs Pendentes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tabular-nums" data-testid="text-pending-legs">
              {legs.filter(l => l.reconciliation.state === "pendente").length}
            </div>
            <p className="text-sm text-muted-foreground">aguardando conciliação</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Conciliados</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tabular-nums text-green-600" data-testid="text-reconciled-legs">
              {legs.filter(l => l.reconciliation.state === "conciliado").length}
            </div>
            <p className="text-sm text-muted-foreground">legs totalmente conciliados</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Legs de Vendas para Conciliar</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingLegs ? (
            <div className="text-center text-muted-foreground py-8">
              Carregando legs...
            </div>
          ) : legs.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Nenhum leg de venda encontrado.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Meio de Pagamento</TableHead>
                    <TableHead>Valor Líquido</TableHead>
                    <TableHead>Parcelas</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {legs.map((leg) => (
                    <TableRow key={leg.saleLegId} data-testid={`row-leg-${leg.saleLegId}`}>
                      <TableCell>{leg.paymentMethod}</TableCell>
                      <TableCell className="tabular-nums">
                        {leg.netAmount.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {leg.settlementPlan.length} parcela(s)
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            leg.reconciliation.state === "conciliado"
                              ? "default"
                              : leg.reconciliation.state === "parcial"
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {leg.reconciliation.state}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {leg.reconciliation.state !== "conciliado" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleSuggest(leg)}
                            disabled={suggestMutation.isPending}
                            data-testid={`button-suggest-${leg.saleLegId}`}
                          >
                            <AlertCircle className="mr-2 h-4 w-4" />
                            Sugerir Matches
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showSuggestions} onOpenChange={setShowSuggestions}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Sugestões de Conciliação</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {suggestMutation.isPending ? (
              <div className="text-center text-muted-foreground py-8">
                Buscando sugestões...
              </div>
            ) : suggestions.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground">
                  Nenhum match automático encontrado.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {suggestions.map((suggestion, i) => (
                  <Card key={i}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1 flex-1">
                          <div className="flex items-center gap-2">
                            <Badge>Parcela {suggestion.parcelN}</Badge>
                            <span className="text-sm font-medium">
                              Score: {suggestion.score.toFixed(0)}%
                            </span>
                          </div>
                          <p className="text-sm font-medium">{suggestion.desc}</p>
                          <p className="text-sm text-muted-foreground">
                            {suggestion.matchReason}
                          </p>
                          <p className="text-sm tabular-nums">
                            Data: {suggestion.date} | Valor:{" "}
                            {suggestion.amount.toLocaleString("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                            })}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleConfirm(suggestion)}
                          disabled={confirmMutation.isPending}
                          data-testid={`button-confirm-${i}`}
                        >
                          <CheckCircle className="mr-2 h-4 w-4" />
                          Confirmar
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
