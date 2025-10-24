import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FileBarChart, Printer, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatPeriodToBR } from "@/lib/dateUtils";

interface RelatoriosProps {
  clientId: string | null;
}

export default function Relatorios({ clientId }: RelatoriosProps) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [period, setPeriod] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);

  // Get last 6 months for tabs
  const getLast6Months = () => {
    const months = [];
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const periodStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      months.push(periodStr);
    }
    return months;
  };

  const periods = getLast6Months();

  const { data: reportHtml, isLoading } = useQuery<string>({
    queryKey: ["/api/reports/view", clientId, selectedPeriod],
    enabled: !!clientId && !!selectedPeriod,
  });

  const generateMutation = useMutation({
    mutationFn: async ({ period, notes }: { period: string; notes?: string }) => {
      return apiRequest("POST", "/api/reports/generate", {
        clientId,
        period,
        notes,
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/reports/view"] });
      setSelectedPeriod(period);
      setDialogOpen(false);
      setPeriod("");
      setNotes("");
      toast({
        title: "Relatório gerado",
        description: "Relatório mensal criado com sucesso!",
      });
    },
  });

  const handleGenerate = () => {
    if (!period) {
      toast({
        title: "Período obrigatório",
        description: "Informe o período do relatório (AAAA-MM).",
        variant: "destructive",
      });
      return;
    }
    generateMutation.mutate({ period, notes });
  };

  const handlePrint = () => {
    window.print();
  };

  if (!clientId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Selecione um cliente para visualizar relatórios</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Relatórios</h1>
          <p className="text-muted-foreground">Gere e visualize relatórios mensais</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-generate-report">
              <FileBarChart className="mr-2 h-4 w-4" />
              Gerar Relatório
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Gerar Relatório Mensal</DialogTitle>
              <DialogDescription>
                Crie um snapshot dos KPIs do mês selecionado
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="period">Período (AAAA-MM)</Label>
                <Input
                  id="period"
                  type="month"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value.replace("-", "-"))}
                  data-testid="input-period"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Observações (opcional)</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Adicione notas ou observações sobre este período..."
                  rows={4}
                  data-testid="textarea-notes"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleGenerate}
                disabled={!period || generateMutation.isPending}
                data-testid="button-confirm-generate"
              >
                {generateMutation.isPending ? "Gerando..." : "Gerar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Period Tabs */}
      <Card>
        <CardHeader>
          <CardTitle>Períodos Disponíveis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 flex-wrap">
            {periods.map((p) => (
              <Button
                key={p}
                variant={selectedPeriod === p ? "default" : "outline"}
                onClick={() => setSelectedPeriod(p)}
                data-testid={`button-period-${p}`}
              >
                {formatPeriodToBR(p)}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Report View */}
      {selectedPeriod && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Relatório: {formatPeriodToBR(selectedPeriod)}</CardTitle>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrint}
                data-testid="button-print"
              >
                <Printer className="mr-2 h-4 w-4" />
                Imprimir
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-12 text-muted-foreground">
                Carregando relatório...
              </div>
            ) : reportHtml ? (
              <div
                className="prose dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: reportHtml }}
                data-testid="report-content"
              />
            ) : (
              <div className="text-center py-12 space-y-4">
                <p className="text-muted-foreground">
                  Nenhum relatório encontrado para este período.
                </p>
                <Button onClick={() => setDialogOpen(true)} data-testid="button-generate-first">
                  Gerar Relatório
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
