import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import type { PFPolicy, PJPolicy } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface ConfiguracoesProps {
  clientId: string | null;
  clientType: "PF" | "PJ" | "BOTH" | null;
}

export default function Configuracoes({ clientId, clientType }: ConfiguracoesProps) {
  const { toast } = useToast();
  
  // PF Policy State
  const [pfPolicy, setPfPolicy] = useState<PFPolicy>({
    targets: { RF: 60, RV: 20, Fundos: 15, Outros: 5 },
    rule50_30_20: false,
  });

  // PJ Policy State
  const [pjPolicy, setPjPolicy] = useState<PJPolicy>({
    cashPolicy: { minRF: 70, maxRV: 10, maxIssuerPct: 30, maxDurationDays: 365 },
  });

  const { data: currentPolicy } = useQuery<PFPolicy | PJPolicy>({
    queryKey: ["/api/policies", clientId],
    enabled: !!clientId,
  });

  useEffect(() => {
    if (currentPolicy) {
      if (clientType === "PF" && "targets" in currentPolicy) {
        setPfPolicy(currentPolicy as PFPolicy);
      }
      if (clientType === "PJ" && "cashPolicy" in currentPolicy) {
        setPjPolicy(currentPolicy as PJPolicy);
      }
    }
  }, [currentPolicy, clientType]);

  const savePolicyMutation = useMutation({
    mutationFn: async (data: PFPolicy | PJPolicy) => {
      return apiRequest("POST", "/api/policies/upsert", {
        clientId,
        data,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      toast({
        title: "Configurações salvas",
        description: "Políticas de investimento atualizadas com sucesso!",
      });
    },
  });

  const handleSavePF = () => {
    const total = pfPolicy.targets.RF + pfPolicy.targets.RV + pfPolicy.targets.Fundos + pfPolicy.targets.Outros;
    if (Math.abs(total - 100) > 0.1) {
      toast({
        title: "Erro de validação",
        description: "A soma dos targets deve ser 100%",
        variant: "destructive",
      });
      return;
    }
    savePolicyMutation.mutate(pfPolicy);
  };

  const handleSavePJ = () => {
    savePolicyMutation.mutate(pjPolicy);
  };

  if (!clientId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Selecione um cliente para configurar políticas</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Configurações</h1>
        <p className="text-muted-foreground">Gerencie políticas e preferências</p>
      </div>

      <Tabs defaultValue={clientType === "PJ" ? "pj" : "pf"}>
        <TabsList>
          {(clientType === "PF" || clientType === "BOTH") && (
            <TabsTrigger value="pf" data-testid="tab-pf">Pessoa Física</TabsTrigger>
          )}
          {(clientType === "PJ" || clientType === "BOTH") && (
            <TabsTrigger value="pj" data-testid="tab-pj">Pessoa Jurídica</TabsTrigger>
          )}
        </TabsList>

        {/* PF Tab */}
        {(clientType === "PF" || clientType === "BOTH") && (
          <TabsContent value="pf" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Metas de Alocação</CardTitle>
                <CardDescription>
                  Defina a alocação ideal do seu portfólio (total deve somar 100%)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="rf-target">Renda Fixa (%)</Label>
                    <Input
                      id="rf-target"
                      type="number"
                      value={pfPolicy.targets.RF}
                      onChange={(e) =>
                        setPfPolicy({
                          ...pfPolicy,
                          targets: { ...pfPolicy.targets, RF: parseFloat(e.target.value) },
                        })
                      }
                      data-testid="input-rf-target"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rv-target">Renda Variável (%)</Label>
                    <Input
                      id="rv-target"
                      type="number"
                      value={pfPolicy.targets.RV}
                      onChange={(e) =>
                        setPfPolicy({
                          ...pfPolicy,
                          targets: { ...pfPolicy.targets, RV: parseFloat(e.target.value) },
                        })
                      }
                      data-testid="input-rv-target"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="fundos-target">Fundos (%)</Label>
                    <Input
                      id="fundos-target"
                      type="number"
                      value={pfPolicy.targets.Fundos}
                      onChange={(e) =>
                        setPfPolicy({
                          ...pfPolicy,
                          targets: { ...pfPolicy.targets, Fundos: parseFloat(e.target.value) },
                        })
                      }
                      data-testid="input-fundos-target"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="outros-target">Outros (%)</Label>
                    <Input
                      id="outros-target"
                      type="number"
                      value={pfPolicy.targets.Outros}
                      onChange={(e) =>
                        setPfPolicy({
                          ...pfPolicy,
                          targets: { ...pfPolicy.targets, Outros: parseFloat(e.target.value) },
                        })
                      }
                      data-testid="input-outros-target"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between pt-4 border-t">
                  <div className="space-y-0.5">
                    <Label htmlFor="rule-50-30-20">Regra 50/30/20</Label>
                    <p className="text-sm text-muted-foreground">
                      Ativar monitoramento da regra 50% essencial, 30% lazer, 20% investimentos
                    </p>
                  </div>
                  <Switch
                    id="rule-50-30-20"
                    checked={pfPolicy.rule50_30_20 || false}
                    onCheckedChange={(checked) =>
                      setPfPolicy({ ...pfPolicy, rule50_30_20: checked })
                    }
                    data-testid="switch-rule-50-30-20"
                  />
                </div>
                <Button
                  onClick={handleSavePF}
                  disabled={savePolicyMutation.isPending}
                  className="w-full"
                  data-testid="button-save-pf"
                >
                  Salvar Configurações
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* PJ Tab */}
        {(clientType === "PJ" || clientType === "BOTH") && (
          <TabsContent value="pj" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Política de Caixa</CardTitle>
                <CardDescription>
                  Configure os limites e regras para gestão de tesouraria
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="min-rf">Renda Fixa Mínima (%)</Label>
                    <Input
                      id="min-rf"
                      type="number"
                      value={pjPolicy.cashPolicy.minRF}
                      onChange={(e) =>
                        setPjPolicy({
                          ...pjPolicy,
                          cashPolicy: { ...pjPolicy.cashPolicy, minRF: parseFloat(e.target.value) },
                        })
                      }
                      data-testid="input-min-rf"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="max-rv">Renda Variável Máxima (%)</Label>
                    <Input
                      id="max-rv"
                      type="number"
                      value={pjPolicy.cashPolicy.maxRV}
                      onChange={(e) =>
                        setPjPolicy({
                          ...pjPolicy,
                          cashPolicy: { ...pjPolicy.cashPolicy, maxRV: parseFloat(e.target.value) },
                        })
                      }
                      data-testid="input-max-rv"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="max-issuer">Máximo por Emissor (%)</Label>
                    <Input
                      id="max-issuer"
                      type="number"
                      value={pjPolicy.cashPolicy.maxIssuerPct}
                      onChange={(e) =>
                        setPjPolicy({
                          ...pjPolicy,
                          cashPolicy: {
                            ...pjPolicy.cashPolicy,
                            maxIssuerPct: parseFloat(e.target.value),
                          },
                        })
                      }
                      data-testid="input-max-issuer"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="max-duration">Prazo Máximo (dias)</Label>
                    <Input
                      id="max-duration"
                      type="number"
                      value={pjPolicy.cashPolicy.maxDurationDays}
                      onChange={(e) =>
                        setPjPolicy({
                          ...pjPolicy,
                          cashPolicy: {
                            ...pjPolicy.cashPolicy,
                            maxDurationDays: parseInt(e.target.value),
                          },
                        })
                      }
                      data-testid="input-max-duration"
                    />
                  </div>
                </div>
                <Button
                  onClick={handleSavePJ}
                  disabled={savePolicyMutation.isPending}
                  className="w-full"
                  data-testid="button-save-pj"
                >
                  Salvar Configurações
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
