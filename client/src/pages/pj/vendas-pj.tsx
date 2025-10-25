import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Upload, Plus, FileSpreadsheet } from "lucide-react";
import { useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface VendasPJProps {
  clientId: string | null;
}

interface Sale {
  saleId: string;
  date: string;
  invoiceNumber: string;
  customer: string;
  channel: string;
  status: string;
  grossAmount: number;
  netAmount: number;
  legs: string[];
}

export default function VendasPJ({ clientId }: VendasPJProps) {
  const { toast } = useToast();
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [openAddDialog, setOpenAddDialog] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const { data: salesData, isLoading, error } = useQuery<{ sales: Sale[] }>({
    queryKey: ["/api/pj/sales/list", { clientId, month }],
    enabled: !!clientId,
  });

  const uploadCsvMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("csv", file);
      formData.append("clientId", clientId!);

      const res = await fetch("/api/pj/sales/importCsv", {
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
        title: "CSV importado com sucesso",
        description: `${data.imported} vendas importadas, ${data.skipped} duplicadas`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/pj/sales/list"] });
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao importar CSV",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCsvUpload = () => {
    csvInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadCsvMutation.mutate(file);
    }
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Carregando vendas...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-destructive">Erro ao carregar vendas: {(error as Error).message}</div>
      </div>
    );
  }

  const sales = salesData?.sales || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-vendas-title">Vendas</h1>
          <p className="text-muted-foreground">Gestão de vendas e recebimentos</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-40"
            data-testid="input-month"
          />
          <Button
            variant="outline"
            onClick={handleCsvUpload}
            disabled={uploadCsvMutation.isPending}
            data-testid="button-import-csv"
          >
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            {uploadCsvMutation.isPending ? "Importando..." : "Importar CSV"}
          </Button>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="hidden"
          />
          <Dialog open={openAddDialog} onOpenChange={setOpenAddDialog}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-sale">
                <Plus className="mr-2 h-4 w-4" />
                Nova Venda
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Adicionar Venda Manualmente</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <p className="text-sm text-muted-foreground">
                  Use o botão "Importar CSV" para adicionar vendas em lote.
                </p>
                <p className="text-sm text-muted-foreground">
                  Para vendas individuais, você pode implementar um formulário aqui.
                </p>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lista de Vendas</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center text-muted-foreground py-8">
              Carregando vendas...
            </div>
          ) : sales.length === 0 ? (
            <div className="text-center py-8 space-y-4">
              <p className="text-muted-foreground">
                Nenhuma venda encontrada para este mês.
              </p>
              <Button onClick={handleCsvUpload} data-testid="button-import-first-csv">
                <Upload className="mr-2 h-4 w-4" />
                Importar CSV de Vendas
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>NF</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Canal</TableHead>
                    <TableHead>Valor Bruto</TableHead>
                    <TableHead>Valor Líquido</TableHead>
                    <TableHead>Legs</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sales.map((sale) => (
                    <TableRow key={sale.saleId} data-testid={`row-sale-${sale.saleId}`}>
                      <TableCell className="tabular-nums">{sale.date}</TableCell>
                      <TableCell>{sale.invoiceNumber}</TableCell>
                      <TableCell>{sale.customer}</TableCell>
                      <TableCell>{sale.channel}</TableCell>
                      <TableCell className="tabular-nums">
                        {sale.grossAmount.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {sale.netAmount.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{sale.legs.length} leg(s)</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={sale.status === "aberta" ? "default" : "secondary"}
                        >
                          {sale.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Formato CSV Esperado</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            O arquivo CSV deve ter as seguintes colunas:
          </p>
          <code className="block bg-muted p-3 rounded text-xs overflow-x-auto">
            data,nota_fiscal,cliente,canal,valor_bruto,meio_pagamento,liquidacao,parcelas,taxa_percentual,taxa_fixa
          </code>
          <p className="text-sm text-muted-foreground">
            Múltiplas linhas com a mesma nota_fiscal serão agregadas como multi-pagamento.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
