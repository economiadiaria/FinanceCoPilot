import { useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, TrendingUp, PieChart } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Position, RebalanceSuggestion } from "@shared/schema";
import { assetClasses } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatToBR } from "@/lib/dateUtils";

interface InvestimentosProps {
  clientId: string | null;
}

export default function Investimentos({ clientId }: InvestimentosProps) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newPosition, setNewPosition] = useState({
    asset: "",
    class: "RF" as const,
    value: "",
    rate: "",
    liquidity: "",
    maturity: "",
  });

  const { data: positions = [], isLoading } = useQuery<Position[]>({
    queryKey: ["/api/investments/positions", clientId],
    enabled: !!clientId,
  });

  const { data: suggestions = [] } = useQuery<RebalanceSuggestion[]>({
    queryKey: ["/api/investments/rebalance/suggest", clientId],
    enabled: !!clientId,
  });

  const addPositionMutation = useMutation({
    mutationFn: async (position: Position) => {
      // This would be implemented in backend
      return apiRequest("POST", "/api/investments/positions", {
        clientId,
        position,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investments/positions"] });
      setDialogOpen(false);
      setNewPosition({
        asset: "",
        class: "RF",
        value: "",
        rate: "",
        liquidity: "",
        maturity: "",
      });
      toast({
        title: "Posição adicionada",
        description: "Nova posição de investimento registrada!",
      });
    },
  });

  const handleAddPosition = () => {
    const position: Position = {
      asset: newPosition.asset,
      class: newPosition.class,
      value: parseFloat(newPosition.value),
      rate: newPosition.rate ? parseFloat(newPosition.rate) : undefined,
      liquidity: newPosition.liquidity || undefined,
      maturity: newPosition.maturity || undefined,
    };
    addPositionMutation.mutate(position);
  };

  if (!clientId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Selecione um cliente para visualizar investimentos</p>
      </div>
    );
  }

  // Calculate allocation
  const totalValue = positions.reduce((sum, p) => sum + p.value, 0);
  const allocation = assetClasses.map((cls) => {
    const value = positions.filter((p) => p.class === cls).reduce((sum, p) => sum + p.value, 0);
    return {
      class: cls,
      value,
      percentage: totalValue > 0 ? (value / totalValue) * 100 : 0,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Investimentos</h1>
          <p className="text-muted-foreground">Gerencie seu portfólio e alocação</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-position">
              <Plus className="mr-2 h-4 w-4" />
              Adicionar Posição
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Nova Posição de Investimento</DialogTitle>
              <DialogDescription>
                Adicione uma nova posição ao seu portfólio
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="asset">Ativo</Label>
                  <Input
                    id="asset"
                    value={newPosition.asset}
                    onChange={(e) => setNewPosition({ ...newPosition, asset: e.target.value })}
                    placeholder="Ex: CDB Banco X"
                    data-testid="input-asset"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="class">Classe</Label>
                  <Select
                    value={newPosition.class}
                    onValueChange={(value: any) => setNewPosition({ ...newPosition, class: value })}
                  >
                    <SelectTrigger id="class" data-testid="select-class">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {assetClasses.map((cls) => (
                        <SelectItem key={cls} value={cls}>
                          {cls}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="value">Valor (R$)</Label>
                  <Input
                    id="value"
                    type="number"
                    value={newPosition.value}
                    onChange={(e) => setNewPosition({ ...newPosition, value: e.target.value })}
                    placeholder="0.00"
                    data-testid="input-value"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rate">Taxa (%)</Label>
                  <Input
                    id="rate"
                    type="number"
                    step="0.01"
                    value={newPosition.rate}
                    onChange={(e) => setNewPosition({ ...newPosition, rate: e.target.value })}
                    placeholder="11.2"
                    data-testid="input-rate"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="liquidity">Liquidez</Label>
                  <Input
                    id="liquidity"
                    value={newPosition.liquidity}
                    onChange={(e) => setNewPosition({ ...newPosition, liquidity: e.target.value })}
                    placeholder="D+1"
                    data-testid="input-liquidity"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maturity">Vencimento</Label>
                  <Input
                    id="maturity"
                    type="date"
                    value={newPosition.maturity}
                    onChange={(e) => setNewPosition({ ...newPosition, maturity: e.target.value })}
                    data-testid="input-maturity"
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleAddPosition}
                disabled={!newPosition.asset || !newPosition.value || addPositionMutation.isPending}
                data-testid="button-save-position"
              >
                Adicionar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Total Alocado
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tabular-nums" data-testid="text-total-allocated">
              R$ {totalValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Posições Ativas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tabular-nums" data-testid="text-positions-count">
              {positions.length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Allocation Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PieChart className="h-5 w-5" />
            Alocação por Classe
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {allocation.map((item) => (
              <div key={item.class} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{item.class}</span>
                  <span className="text-sm text-muted-foreground">
                    R$ {item.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} ({item.percentage.toFixed(1)}%)
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${item.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Positions Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {positions.map((position, index) => (
          <Card key={index} data-testid={`position-card-${index}`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-lg font-semibold">{position.asset}</CardTitle>
              <Badge variant="secondary">{position.class}</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-2xl font-bold tabular-nums">
                R$ {position.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                {position.rate && (
                  <div>
                    <div className="text-muted-foreground">Taxa</div>
                    <div className="font-medium">{(position.rate * 100).toFixed(2)}% a.a.</div>
                  </div>
                )}
                {position.liquidity && (
                  <div>
                    <div className="text-muted-foreground">Liquidez</div>
                    <div className="font-medium">{position.liquidity}</div>
                  </div>
                )}
                {position.maturity && (
                  <div>
                    <div className="text-muted-foreground">Vencimento</div>
                    <div className="font-medium">{formatToBR(position.maturity)}</div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Rebalance Suggestions */}
      {suggestions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Sugestões de Rebalanceamento
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-4 text-sm font-medium">Classe</th>
                    <th className="text-right p-4 text-sm font-medium">Atual</th>
                    <th className="text-right p-4 text-sm font-medium">Meta</th>
                    <th className="text-right p-4 text-sm font-medium">Diferença</th>
                    <th className="text-left p-4 text-sm font-medium">Ação Sugerida</th>
                  </tr>
                </thead>
                <tbody>
                  {suggestions.map((suggestion, index) => (
                    <tr key={index} className="border-t" data-testid={`suggestion-${index}`}>
                      <td className="p-4 font-medium">{suggestion.class}</td>
                      <td className="p-4 text-right tabular-nums">{suggestion.currentPct.toFixed(1)}%</td>
                      <td className="p-4 text-right tabular-nums">{suggestion.targetPct.toFixed(1)}%</td>
                      <td className={`p-4 text-right tabular-nums font-medium ${
                        suggestion.difference > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                      }`}>
                        {suggestion.difference > 0 ? "+" : ""}{suggestion.difference.toFixed(1)}pp
                      </td>
                      <td className="p-4">{suggestion.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
