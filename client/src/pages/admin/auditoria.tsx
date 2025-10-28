import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import type { AuditLogEntry } from "@shared/schema";

interface AuditLogResponse {
  logs: AuditLogEntry[];
}

function formatDate(dateISO: string) {
  try {
    return new Date(dateISO).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateISO;
  }
}

function renderMetadata(metadata: Record<string, unknown>) {
  if (!metadata || Object.keys(metadata).length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <pre className="bg-muted/40 text-xs rounded-md p-2 whitespace-pre-wrap break-words">
      {JSON.stringify(metadata, null, 2)}
    </pre>
  );
}

export default function AdminAuditoria() {
  const { user } = useAuth();
  const query = useQuery<AuditLogResponse>({
    queryKey: ["/api/audit/logs"],
    enabled: user?.role === "master",
    queryFn: async () => {
      const res = await fetch("/api/audit/logs", { credentials: "include" });
      if (!res.ok) {
        throw new Error("Não foi possível carregar a auditoria");
      }
      return res.json();
    },
  });

  const logs = query.data?.logs ?? [];

  if (user?.role !== "master") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Auditoria</h1>
        <p className="text-muted-foreground">Somente usuários master podem acessar esta área.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Auditoria da organização</h1>
          <p className="text-muted-foreground">
            Rastreamos ações críticas de usuários para garantir transparência e conformidade.
          </p>
        </div>
        <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
          {query.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="ml-2">Atualizar</span>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Trilha de auditoria</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando auditoria...
            </div>
          ) : logs.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              Nenhum evento registrado até o momento.
            </div>
          ) : (
            <ScrollArea className="h-[520px]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-3 pr-3 font-medium">Data</th>
                    <th className="py-3 pr-3 font-medium">Usuário</th>
                    <th className="py-3 pr-3 font-medium">Evento</th>
                    <th className="py-3 pr-3 font-medium">Alvo</th>
                    <th className="py-3 pr-3 font-medium">Metadados</th>
                    <th className="py-3 pr-3 font-medium">PII</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.auditId} className="border-b last:border-none align-top">
                      <td className="py-3 pr-3 whitespace-nowrap">{formatDate(log.createdAt)}</td>
                      <td className="py-3 pr-3">
                        <div className="font-medium">{log.userId}</div>
                        <div className="text-xs text-muted-foreground">{log.actorRole}</div>
                      </td>
                      <td className="py-3 pr-3">
                        <Badge variant="secondary">{log.eventType}</Badge>
                      </td>
                      <td className="py-3 pr-3">
                        <div className="font-medium">{log.targetType}</div>
                        {log.targetId && <div className="text-xs text-muted-foreground">{log.targetId}</div>}
                      </td>
                      <td className="py-3 pr-3">{renderMetadata(log.metadata)}</td>
                      <td className="py-3 pr-3">
                        {log.piiSnapshot && Object.keys(log.piiSnapshot).length > 0 ? (
                          <pre className="bg-muted/40 text-xs rounded-md p-2 whitespace-pre-wrap break-words">
                            {JSON.stringify(log.piiSnapshot, null, 2)}
                          </pre>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
