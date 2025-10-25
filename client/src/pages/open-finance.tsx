import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Building2, RefreshCw, Plus, Check, AlertCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

type OFItem = {
  itemId: string;
  institutionName: string;
  status: string;
  createdAt: string;
  lastSyncAt?: string;
};

export default function OpenFinancePage() {
  const { toast } = useToast();
  
  // Get current client from localStorage
  const selectedClientId = localStorage.getItem("selectedClientId");

  // Fetch items
  const { data: itemsData, isLoading } = useQuery<{ items: OFItem[] }>({
    queryKey: ["/api/openfinance/items", selectedClientId],
    enabled: !!selectedClientId,
  });

  const items = itemsData?.items || [];

  // Connect bank mutation
  const connectMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/openfinance/consent/start", { clientId: selectedClientId });
      return response.json();
    },
    onSuccess: (data: any) => {
      if (data.mode === "simulado") {
        toast({
          title: "Modo Simulado",
          description: "Credenciais do Pluggy não configuradas. Execute sincronização para gerar dados fictícios.",
        });
      } else if (data.connectToken) {
        // In real implementation, load Pluggy Connect Widget here
        toast({
          title: "Widget Disponível",
          description: "Token de conexão criado. Implemente o widget Pluggy aqui.",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Erro ao Conectar",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: async (full: boolean = false) => {
      const response = await apiRequest("POST", "/api/openfinance/sync", { clientId: selectedClientId, full });
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/openfinance/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/positions"] });
      
      const { synced, mode } = data;
      toast({
        title: mode === "simulado" ? "Sincronização Simulada" : "Sincronização Completa",
        description: `${synced.accounts} contas, ${synced.transactions} transações, ${synced.positions} posições`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Erro ao Sincronizar",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (!selectedClientId) {
    return (
      <div className="flex items-center justify-center h-full">
        <Alert className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Selecione um cliente para gerenciar conexões bancárias.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Open Finance</h1>
          <p className="text-muted-foreground">
            Conecte bancos e sincronize dados automaticamente
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => syncMutation.mutate(false)}
            disabled={syncMutation.isPending || items.length === 0}
            variant="outline"
            data-testid="button-sync"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Sincronizar
          </Button>
          <Button
            onClick={() => connectMutation.mutate()}
            disabled={connectMutation.isPending}
            data-testid="button-connect-bank"
          >
            <Plus className="h-4 w-4 mr-2" />
            Conectar Banco
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/2 mt-2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4 mt-2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12">
          <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">Nenhuma Conexão</h3>
          <p className="text-muted-foreground text-center mb-4">
            Conecte um banco para começar a sincronizar dados automaticamente.
          </p>
          <Button onClick={() => connectMutation.mutate()} data-testid="button-connect-first-bank">
            <Plus className="h-4 w-4 mr-2" />
            Conectar Primeiro Banco
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <Card key={item.itemId} data-testid={`card-connection-${item.itemId}`}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-muted-foreground" />
                    <CardTitle className="text-base">{item.institutionName}</CardTitle>
                  </div>
                  <Badge
                    variant={item.status === "active" ? "default" : "secondary"}
                    data-testid={`badge-status-${item.itemId}`}
                  >
                    {item.status === "active" ? (
                      <>
                        <Check className="h-3 w-3 mr-1" />
                        Ativo
                      </>
                    ) : (
                      item.status
                    )}
                  </Badge>
                </div>
                <CardDescription className="text-xs">
                  ID: {item.itemId.slice(0, 12)}...
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Conectado em:</span>
                  <span className="font-mono" data-testid={`text-created-${item.itemId}`}>
                    {item.createdAt}
                  </span>
                </div>
                {item.lastSyncAt && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Última sincronização:</span>
                    <span className="font-mono" data-testid={`text-last-sync-${item.itemId}`}>
                      {item.lastSyncAt}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Como Funciona</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            • <strong>Conectar Banco:</strong> Autorize o acesso seguro aos seus dados bancários via Open Finance (Pluggy).
          </p>
          <p>
            • <strong>Sincronizar:</strong> Atualize suas transações, contas e investimentos automaticamente.
          </p>
          <p>
            • <strong>Modo Simulado:</strong> Se as credenciais do Pluggy não estiverem configuradas, dados fictícios serão criados.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
