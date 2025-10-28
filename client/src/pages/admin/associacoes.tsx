import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import type { Client } from "@shared/schema";

type DirectoryUser = {
  userId: string;
  name: string;
  email: string;
  role: "master" | "consultor" | "cliente";
  clientIds?: string[];
};

interface UsersDirectoryResponse {
  currentUser: DirectoryUser;
  consultants: DirectoryUser[];
  masters: DirectoryUser[];
  clients: Client[];
  clientUsers: DirectoryUser[];
}

export default function AdminAssociacoes() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedConsultantId, setSelectedConsultantId] = useState<string>("none");
  const [selectedMasterId, setSelectedMasterId] = useState<string>("none");

  const {
    data: directory,
    isLoading,
    error,
  } = useQuery<UsersDirectoryResponse>({
    queryKey: ["/api/users/directory"],
    enabled: user?.role === "master",
  });

  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!selectedClient) {
        throw new Error("Selecione um cliente");
      }

      const payload = {
        clientId: selectedClient.clientId,
        name: selectedClient.name,
        type: selectedClient.type,
        email: selectedClient.email,
        consultantId: selectedConsultantId === "none" ? null : selectedConsultantId,
        masterId: selectedMasterId === "none" ? null : selectedMasterId,
      };

      return apiRequest("POST", "/api/client/upsert", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users/directory"] });
      toast({
        title: "Associações atualizadas",
        description: "Consultor e usuário master vinculados com sucesso",
      });
      setAssignDialogOpen(false);
    },
    onError: (mutationError: any) => {
      toast({
        title: "Não foi possível atualizar",
        description: mutationError?.message || "Tente novamente mais tarde.",
        variant: "destructive",
      });
    },
  });

  const openAssignDialog = (client: Client) => {
    setSelectedClient(client);
    setSelectedConsultantId(client.consultantId ?? "none");
    setSelectedMasterId(client.masterId ?? "none");
    setAssignDialogOpen(true);
  };

  if (!user || user.role !== "master") {
    return (
      <Card className="max-w-3xl mx-auto">
        <CardHeader>
          <CardTitle>Acesso restrito</CardTitle>
          <CardDescription>
            Apenas usuários master podem gerenciar associações de consultores e clientes.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-b-2 border-primary"></div>
          <p className="text-muted-foreground">Carregando usuários e clientes...</p>
        </div>
      </div>
    );
  }

  if (error || !directory) {
    return (
      <Card className="max-w-3xl mx-auto">
        <CardHeader>
          <CardTitle>Erro ao carregar dados</CardTitle>
          <CardDescription>
            Não foi possível recuperar as informações de usuários. Atualize a página ou tente novamente mais tarde.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { consultants, masters, clients } = directory;

  const consultantSummaries = consultants.map((consultant) => ({
    consultant,
    clientCount: clients.filter((client) => client.consultantId === consultant.userId).length,
  }));

  const unassignedClients = clients.filter((client) => !client.consultantId || !client.masterId);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Associações de consultores e clientes</h1>
        <p className="text-muted-foreground">
          Vincule clientes aos consultores responsáveis e mantenha o usuário master alinhado com cada conta PJ/PF.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Consultores ativos</CardTitle>
            <CardDescription>Número total de consultores cadastrados</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{consultants.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Clientes geridos</CardTitle>
            <CardDescription>Clientes com consultor definido</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {clients.filter((client) => Boolean(client.consultantId)).length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Pendências</CardTitle>
            <CardDescription>Clientes sem consultor ou master vinculado</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{unassignedClients.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Resumo por consultor</CardTitle>
          <CardDescription>Distribuição de clientes por consultor responsável</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {consultantSummaries.map(({ consultant, clientCount }) => (
              <div
                key={consultant.userId}
                className="rounded-lg border p-4 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{consultant.name}</p>
                  <Badge variant={clientCount > 0 ? "outline" : "secondary"}>
                    {clientCount} cliente{clientCount === 1 ? "" : "s"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground truncate">{consultant.email}</p>
              </div>
            ))}
            {consultantSummaries.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhum consultor cadastrado até o momento.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Clientes e vínculos</CardTitle>
          <CardDescription>Veja o consultor e o master responsáveis por cada cliente</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Consultor</TableHead>
                <TableHead>Master</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((client) => {
                const consultant = consultants.find((c) => c.userId === client.consultantId);
                const master = masters.find((m) => m.userId === client.masterId);

                return (
                  <TableRow key={client.clientId}>
                    <TableCell className="font-medium">
                      <div className="flex flex-col">
                        <span>{client.name}</span>
                        <span className="text-xs text-muted-foreground">{client.email}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{client.type}</Badge>
                    </TableCell>
                    <TableCell>
                      {consultant ? (
                        <div className="flex flex-col">
                          <span>{consultant.name}</span>
                          <span className="text-xs text-muted-foreground">{consultant.email}</span>
                        </div>
                      ) : (
                        <Badge variant="destructive">Sem consultor</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {master ? (
                        <div className="flex flex-col">
                          <span>{master.name}</span>
                          <span className="text-xs text-muted-foreground">{master.email}</span>
                        </div>
                      ) : (
                        <Badge variant="secondary">Sem master</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        onClick={() => openAssignDialog(client)}
                        variant="outline"
                      >
                        Gerenciar
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {clients.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    Nenhum cliente cadastrado até o momento.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Atualizar vínculos</DialogTitle>
            <DialogDescription>
              Selecione o consultor e o usuário master responsáveis por {selectedClient?.name}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="assign-consultant">
                Consultor responsável
              </label>
              <Select
                value={selectedConsultantId}
                onValueChange={setSelectedConsultantId}
                disabled={assignMutation.isPending}
              >
                <SelectTrigger id="assign-consultant" data-testid="assign-select-consultant">
                  <SelectValue placeholder="Selecione um consultor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem consultor</SelectItem>
                  {consultants.map((consultant) => (
                    <SelectItem key={consultant.userId} value={consultant.userId}>
                      {consultant.name} ({consultant.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="assign-master">
                Usuário master
              </label>
              <Select
                value={selectedMasterId}
                onValueChange={setSelectedMasterId}
                disabled={assignMutation.isPending}
              >
                <SelectTrigger id="assign-master" data-testid="assign-select-master">
                  <SelectValue placeholder="Selecione um usuário master" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem master</SelectItem>
                  {masters.map((master) => (
                    <SelectItem key={master.userId} value={master.userId}>
                      {master.name} ({master.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAssignDialogOpen(false)}
              disabled={assignMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => assignMutation.mutate()}
              disabled={assignMutation.isPending || !selectedClient}
            >
              {assignMutation.isPending ? "Salvando..." : "Salvar vínculos"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
