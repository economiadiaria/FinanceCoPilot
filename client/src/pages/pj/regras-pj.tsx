import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Brain } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface RegrasPJProps {
  clientId: string | null;
  clientType: string | null;
}

interface CategorizationRule {
  ruleId: string;
  pattern: string;
  matchType: string;
  dfcCategory: string;
  dfcItem: string;
  createdAt: string;
}

export default function RegrasPJ({ clientId, clientType }: RegrasPJProps) {
  const { toast } = useToast();
  const [openDialog, setOpenDialog] = useState(false);
  const [pattern, setPattern] = useState("");
  const [matchType, setMatchType] = useState("contains");
  const [dfcCategory, setDfcCategory] = useState("Operacional");
  const [dfcItem, setDfcItem] = useState("");

  const { data: rulesData, isLoading, error } = useQuery<{ rules: CategorizationRule[] }>({
    queryKey: ["/api/pj/categorization/rules", { clientId }],
    enabled: !!clientId && (clientType === "PJ" || clientType === "BOTH"),
  });

  const createRuleMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/pj/categorization/rules", { clientId, ...data });
      return await res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Regra criada com sucesso",
        description: `${data.retroactiveCount} transações foram automaticamente categorizadas`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/pj/categorization/rules"] });
      setOpenDialog(false);
      setPattern("");
      setDfcItem("");
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao criar regra",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!pattern || !dfcItem) {
      toast({
        title: "Campos obrigatórios",
        description: "Preencha o padrão e o item DFC",
        variant: "destructive",
      });
      return;
    }

    createRuleMutation.mutate({
      pattern,
      matchType,
      dfcCategory,
      dfcItem,
      applyRetroactive: true,
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

  if (clientType !== "PJ" && clientType !== "BOTH") {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <Brain className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-2xl font-bold text-muted-foreground">
          Esta funcionalidade é exclusiva para clientes PJ
        </h1>
        <p className="text-muted-foreground">
          Selecione um cliente do tipo Pessoa Jurídica para configurar regras de categorização
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Carregando regras de categorização...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-destructive">
          Erro ao carregar regras: {(error as Error).message}
        </div>
      </div>
    );
  }

  const rules = rulesData?.rules || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-regras-title">
            Regras de Categorização
          </h1>
          <p className="text-muted-foreground">
            Automatize a categorização de transações bancárias
          </p>
        </div>
        <Dialog open={openDialog} onOpenChange={setOpenDialog}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-rule">
              <Plus className="mr-2 h-4 w-4" />
              Nova Regra
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Criar Regra de Categorização</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="pattern">Padrão</Label>
                <Input
                  id="pattern"
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  placeholder="Ex: UBER, PIX, PAGAMENTO"
                  data-testid="input-pattern"
                />
                <p className="text-xs text-muted-foreground">
                  Texto que deve aparecer na descrição da transação
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="matchType">Tipo de Match</Label>
                <Select value={matchType} onValueChange={setMatchType}>
                  <SelectTrigger id="matchType" data-testid="select-match-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="exact">Exato</SelectItem>
                    <SelectItem value="contains">Contém</SelectItem>
                    <SelectItem value="startsWith">Começa com</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="dfcCategory">Categoria DFC</Label>
                <Select value={dfcCategory} onValueChange={setDfcCategory}>
                  <SelectTrigger id="dfcCategory" data-testid="select-dfc-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Operacional">Operacional</SelectItem>
                    <SelectItem value="Investimento">Investimento</SelectItem>
                    <SelectItem value="Financiamento">Financiamento</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="dfcItem">Item DFC</Label>
                <Input
                  id="dfcItem"
                  value={dfcItem}
                  onChange={(e) => setDfcItem(e.target.value)}
                  placeholder="Ex: Transporte, Fornecedores, Taxas"
                  data-testid="input-dfc-item"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpenDialog(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={createRuleMutation.isPending}
                  data-testid="button-submit-rule"
                >
                  {createRuleMutation.isPending ? "Criando..." : "Criar Regra"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Como funcionam as regras?
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            As regras aprendem padrões nas descrições das transações bancárias e
            categorizam automaticamente transações futuras.
          </p>
          <p>
            <strong>Retroativo:</strong> Ao criar uma regra, todas as transações
            existentes que combinam com o padrão são automaticamente categorizadas.
          </p>
          <p>
            <strong>Prospectivo:</strong> Novas transações importadas via OFX são
            automaticamente categorizadas se combinarem com alguma regra.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Regras Ativas ({rules.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center text-muted-foreground py-8">
              Carregando regras...
            </div>
          ) : rules.length === 0 ? (
            <div className="text-center py-8 space-y-4">
              <p className="text-muted-foreground">Nenhuma regra criada ainda.</p>
              <Button onClick={() => setOpenDialog(true)} data-testid="button-create-first-rule">
                <Plus className="mr-2 h-4 w-4" />
                Criar Primeira Regra
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Padrão</TableHead>
                    <TableHead>Match</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Criada em</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((rule) => (
                    <TableRow key={rule.ruleId} data-testid={`row-rule-${rule.ruleId}`}>
                      <TableCell className="font-medium">{rule.pattern}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{rule.matchType}</Badge>
                      </TableCell>
                      <TableCell>{rule.dfcCategory}</TableCell>
                      <TableCell>{rule.dfcItem}</TableCell>
                      <TableCell className="tabular-nums">
                        {new Date(rule.createdAt).toLocaleDateString("pt-BR")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
