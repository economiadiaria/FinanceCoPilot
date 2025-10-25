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
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

interface VendasPJProps {
  clientId: string | null;
}

interface Sale {
  saleId: string;
  date: string;
  invoiceNumber: string;
  customer: {
    name: string;
    doc?: string;
    email?: string;
    telefone?: string;
  };
  channel: string;
  status: string;
  grossAmount: number;
  netAmount: number;
  legs: Array<{
    method: string;
    installments: number;
    grossAmount: number;
    fees: number;
    netAmount: number;
  }>;
}

const addSaleSchema = z.object({
  date: z.string().min(1, "Data é obrigatória"),
  invoiceNumber: z.string().optional(),
  customerName: z.string().min(1, "Nome do cliente é obrigatório"),
  customerDoc: z.string().optional(),
  customerEmail: z.string().optional(),
  customerPhone: z.string().optional(),
  channel: z.string().min(1, "Canal é obrigatório"),
  comment: z.string().optional(),
  paymentMethod: z.string().min(1, "Método de pagamento é obrigatório"),
  gateway: z.string().optional(),
  installments: z.coerce.number().min(1).default(1),
  grossAmount: z.coerce.number().min(0.01, "Valor bruto deve ser maior que zero"),
  fees: z.coerce.number().min(0).default(0),
  authorizedCode: z.string().optional(),
});

type AddSaleForm = z.infer<typeof addSaleSchema>;

export default function VendasPJ({ clientId }: VendasPJProps) {
  const { toast } = useToast();
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [openAddDialog, setOpenAddDialog] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<AddSaleForm>({
    resolver: zodResolver(addSaleSchema),
    defaultValues: {
      date: "",
      invoiceNumber: "",
      customerName: "",
      customerDoc: "",
      customerEmail: "",
      customerPhone: "",
      channel: "",
      comment: "",
      paymentMethod: "",
      gateway: "",
      installments: 1,
      grossAmount: 0,
      fees: 0,
      authorizedCode: "",
    },
  });

  const { data: salesData, isLoading, error } = useQuery<{ sales: Sale[] }>({
    queryKey: ["/api/pj/sales/list", { clientId, month }],
    enabled: !!clientId,
  });

  const addSaleMutation = useMutation({
    mutationFn: async (data: AddSaleForm) => {
      return await apiRequest("POST", "/api/pj/sales/add", {
        clientId,
        date: data.date,
        invoiceNumber: data.invoiceNumber || undefined,
        customer: {
          name: data.customerName,
          doc: data.customerDoc || undefined,
          email: data.customerEmail || undefined,
          telefone: data.customerPhone || undefined,
        },
        channel: data.channel,
        comment: data.comment || undefined,
        legs: [
          {
            method: data.paymentMethod,
            gateway: data.gateway || undefined,
            installments: data.installments,
            grossAmount: data.grossAmount,
            fees: data.fees,
            authorizedCode: data.authorizedCode || undefined,
          },
        ],
      });
    },
    onSuccess: () => {
      toast({
        title: "Venda adicionada com sucesso",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/pj/sales/list"] });
      setOpenAddDialog(false);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao adicionar venda",
        description: error.message,
        variant: "destructive",
      });
    },
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

  const onSubmitSale = (data: AddSaleForm) => {
    addSaleMutation.mutate(data);
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
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Adicionar Venda Manualmente</DialogTitle>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmitSale)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Data da Venda *</FormLabel>
                        <FormControl>
                          <Input placeholder="DD/MM/YYYY" {...field} data-testid="input-sale-date" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="invoiceNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Número da NF</FormLabel>
                        <FormControl>
                          <Input placeholder="Ex: 12345" {...field} data-testid="input-invoice-number" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="space-y-2">
                    <h3 className="font-medium">Cliente</h3>
                    <FormField
                      control={form.control}
                      name="customerName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nome *</FormLabel>
                          <FormControl>
                            <Input placeholder="Nome do cliente" {...field} data-testid="input-customer-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="customerDoc"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>CPF/CNPJ</FormLabel>
                          <FormControl>
                            <Input placeholder="000.000.000-00" {...field} data-testid="input-customer-doc" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="customerEmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input type="email" placeholder="cliente@example.com" {...field} data-testid="input-customer-email" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="customerPhone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Telefone</FormLabel>
                          <FormControl>
                            <Input placeholder="(00) 00000-0000" {...field} data-testid="input-customer-phone" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="channel"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Canal de Venda *</FormLabel>
                        <FormControl>
                          <Input placeholder="Ex: Loja Física, E-commerce, Marketplace" {...field} data-testid="input-channel" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="comment"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Comentário</FormLabel>
                        <FormControl>
                          <Input placeholder="Observações sobre a venda" {...field} data-testid="input-comment" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="space-y-2">
                    <h3 className="font-medium">Pagamento</h3>
                    <FormField
                      control={form.control}
                      name="paymentMethod"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Método *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-payment-method">
                                <SelectValue placeholder="Selecione o método" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="pix">PIX</SelectItem>
                              <SelectItem value="credito">Crédito</SelectItem>
                              <SelectItem value="debito">Débito</SelectItem>
                              <SelectItem value="boleto">Boleto</SelectItem>
                              <SelectItem value="dinheiro">Dinheiro</SelectItem>
                              <SelectItem value="transferencia">Transferência</SelectItem>
                              <SelectItem value="link">Link de Pagamento</SelectItem>
                              <SelectItem value="gateway">Gateway</SelectItem>
                              <SelectItem value="outro">Outro</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="gateway"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Gateway (se aplicável)</FormLabel>
                          <FormControl>
                            <Input placeholder="Ex: PagSeguro, MercadoPago" {...field} data-testid="input-gateway" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="installments"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Parcelas *</FormLabel>
                          <FormControl>
                            <Input type="number" min="1" {...field} data-testid="input-installments" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="grossAmount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Valor Bruto *</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" min="0.01" placeholder="1000.00" {...field} data-testid="input-gross-amount" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="fees"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Taxas</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" min="0" placeholder="0.00" {...field} data-testid="input-fees" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="authorizedCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Código de Autorização</FormLabel>
                          <FormControl>
                            <Input placeholder="Código da transação" {...field} data-testid="input-authorized-code" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setOpenAddDialog(false)}
                      data-testid="button-cancel-sale"
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="submit"
                      disabled={addSaleMutation.isPending}
                      data-testid="button-submit-sale"
                    >
                      {addSaleMutation.isPending ? "Salvando..." : "Salvar Venda"}
                    </Button>
                  </div>
                </form>
              </Form>
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
                      <TableCell>{sale.invoiceNumber || "-"}</TableCell>
                      <TableCell>{sale.customer?.name || "-"}</TableCell>
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
                        <Badge variant="outline">{sale.legs?.length || 0} leg(s)</Badge>
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
