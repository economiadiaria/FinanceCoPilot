import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
type DirectoryUser = {
  userId: string;
  name: string;
  email: string;
  role: "master" | "consultor" | "cliente";
};

interface UsersDirectoryResponse {
  consultants: DirectoryUser[];
  masters: DirectoryUser[];
}

interface NewClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClientCreated: (clientId: string) => void;
}

export function NewClientDialog({ open, onOpenChange, onClientCreated }: NewClientDialogProps) {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    clientId: "",
    name: "",
    type: "PF" as "PF" | "PJ" | "BOTH",
    email: "",
    consultantId: "",
    masterId: "",
  });

  const { data: directory, isLoading: directoryLoading } = useQuery<UsersDirectoryResponse>({
    queryKey: ["/api/users/directory"],
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return apiRequest("POST", "/api/client/upsert", {
        clientId: data.clientId,
        name: data.name,
        type: data.type,
        email: data.email,
        consultantId: data.consultantId ? data.consultantId : null,
        masterId: data.masterId ? data.masterId : null,
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users/directory"] });
      toast({
        title: "Cliente criado",
        description: "Novo cliente cadastrado com sucesso!",
      });
      onClientCreated(formData.clientId);
      onOpenChange(false);
      setFormData({
        clientId: "",
        name: "",
        type: "PF",
        email: "",
        consultantId: "",
        masterId: "",
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.response?.data?.error || error?.message || "Verifique os dados e tente novamente.";
      toast({
        title: "Erro ao criar cliente",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.clientId || !formData.name || !formData.email) {
      toast({
        title: "Campos obrigatórios",
        description: "Preencha todos os campos obrigatórios: ID, nome e email.",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo Cliente</DialogTitle>
          <DialogDescription>
            Cadastre um novo cliente PF ou PJ no sistema
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="clientId">ID do Cliente *</Label>
              <Input
                id="clientId"
                value={formData.clientId}
                onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
                placeholder="Ex: lucas_pf ou empresa_xyz_pj"
                data-testid="input-client-id"
              />
              <p className="text-xs text-muted-foreground">
                Use um identificador único (ex: nome_pf ou nome_empresa_pj)
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Nome *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Nome do cliente ou empresa"
                data-testid="input-client-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">Tipo *</Label>
              <Select
                value={formData.type}
                onValueChange={(value: any) => setFormData({ ...formData, type: value })}
              >
                <SelectTrigger id="type" data-testid="select-client-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PF">Pessoa Física</SelectItem>
                  <SelectItem value="PJ">Pessoa Jurídica</SelectItem>
                  <SelectItem value="BOTH">Ambos (PF + PJ)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="email@exemplo.com"
                data-testid="input-client-email"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="consultantId">Consultor responsável</Label>
              <Select
                value={formData.consultantId || "none"}
                onValueChange={(value: string) =>
                  setFormData({
                    ...formData,
                    consultantId: value === "none" ? "" : value,
                  })
                }
                disabled={directoryLoading || (directory?.consultants?.length ?? 0) === 0}
              >
                <SelectTrigger id="consultantId" data-testid="select-consultant">
                  <SelectValue placeholder="Selecione um consultor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem consultor atribuído</SelectItem>
                  {(directory?.consultants ?? []).map((consultant) => (
                    <SelectItem key={consultant.userId} value={consultant.userId}>
                      {consultant.name} ({consultant.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="masterId">Usuário master responsável</Label>
              <Select
                value={formData.masterId || "none"}
                onValueChange={(value: string) =>
                  setFormData({
                    ...formData,
                    masterId: value === "none" ? "" : value,
                  })
                }
                disabled={directoryLoading || (directory?.masters?.length ?? 0) === 0}
              >
                <SelectTrigger id="masterId" data-testid="select-master">
                  <SelectValue placeholder="Selecione um usuário master" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem master atribuído</SelectItem>
                  {(directory?.masters ?? []).map((master) => (
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
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending}
              data-testid="button-create-client"
            >
              {createMutation.isPending ? "Criando..." : "Criar Cliente"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
