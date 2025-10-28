import { useEffect, useMemo, useState } from "react";
import { Switch, Route } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { ClientSelector } from "@/components/client-selector";
import { NewClientDialog } from "@/components/new-client-dialog";
import { UserMenu } from "@/components/user-menu";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Dashboard from "@/pages/dashboard";
import Transacoes from "@/pages/transacoes";
import Investimentos from "@/pages/investimentos";
import Relatorios from "@/pages/relatorios";
import Configuracoes from "@/pages/configuracoes";
import OpenFinancePage from "@/pages/open-finance";
import LoginPage from "@/pages/login";
import DashboardPJ from "@/pages/pj/dashboard-pj";
import VendasPJ from "@/pages/pj/vendas-pj";
import ConciliacaoPJ from "@/pages/pj/conciliacao-pj";
import RegrasPJ from "@/pages/pj/regras-pj";
import RelatoriosPJ from "@/pages/pj/relatorios-pj";
import type { Client } from "@shared/schema";
import AdminAssociacoes from "@/pages/admin/associacoes";
import AdminAuditoria from "@/pages/admin/auditoria";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { mockBankAccounts } from "@/services/pj/mockData";

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route>
        <ProtectedRoute>
          <AuthenticatedApp />
        </ProtectedRoute>
      </Route>
    </Switch>
  );
}

function AuthenticatedApp() {
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [selectedBankAccountId, setSelectedBankAccountId] = useState<string | null>(null);
  const [newClientDialogOpen, setNewClientDialogOpen] = useState(false);
  const { user } = useAuth();

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const filteredClients = useMemo(() => {
    if (!user) {
      return [] as Client[];
    }

    if (user.role === "master") {
      return clients;
    }

    const allowedIds = new Set(user.clientIds ?? []);
    return clients.filter((client) => allowedIds.has(client.clientId));
  }, [clients, user]);

  useEffect(() => {
    if (!filteredClients.length) {
      setSelectedClient(null);
      return;
    }

    if (!selectedClient || !filteredClients.some((client) => client.clientId === selectedClient)) {
      setSelectedClient(filteredClients[0].clientId);
    }
  }, [filteredClients, selectedClient]);

  const currentClient = filteredClients.find((c) => c.clientId === selectedClient) ?? null;
  const isPJClient = currentClient?.type === "PJ" || currentClient?.type === "BOTH";
  const availableBankAccounts = useMemo(() => {
    if (!selectedClient) {
      return [] as typeof mockBankAccounts;
    }

    return mockBankAccounts.filter((account) => {
      if (!account.isActive) {
        return false;
      }

      if (!account.clientIds?.length) {
        return true;
      }

      return account.clientIds.includes(selectedClient);
    });
  }, [selectedClient]);

  useEffect(() => {
    setSelectedBankAccountId(null);
  }, [selectedClient]);

  useEffect(() => {
    if (
      selectedBankAccountId &&
      !availableBankAccounts.some((account) => account.id === selectedBankAccountId)
    ) {
      setSelectedBankAccountId(null);
    }
  }, [availableBankAccounts, selectedBankAccountId]);

  useEffect(() => {
    if (!isPJClient) {
      setSelectedBankAccountId(null);
    }
  }, [isPJClient]);

  return (
    <div className="flex h-screen w-full">
      <AppSidebar />
      <div className="flex flex-col flex-1">
        <header className="flex items-center justify-between p-4 border-b gap-4">
          <div className="flex items-center gap-4">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold hidden md:block">Copiloto Financeiro</h2>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ClientSelector
              clients={filteredClients}
              selectedClient={selectedClient}
              onSelectClient={setSelectedClient}
              onNewClient={user?.role === "master" ? () => setNewClientDialogOpen(true) : undefined}
            />
            {isPJClient && (
              <Select
                value={selectedBankAccountId ?? undefined}
                onValueChange={setSelectedBankAccountId}
                disabled={!availableBankAccounts.length}
              >
                <SelectTrigger className="w-[240px]" data-testid="select-bank-account">
                  <SelectValue placeholder="Selecione uma conta PJ" />
                </SelectTrigger>
                <SelectContent>
                  {availableBankAccounts.length ? (
                    availableBankAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        <div className="flex flex-col">
                          <span className="font-medium">{account.bankName}</span>
                          <span className="text-xs text-muted-foreground">
                            {account.accountType} • {account.accountNumberMask}
                          </span>
                        </div>
                      </SelectItem>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      Nenhuma conta disponível
                    </div>
                  )}
                </SelectContent>
              </Select>
            )}
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6 md:p-8">
          <div className="max-w-7xl mx-auto">
            <Switch>
              <Route path="/">
                <Dashboard clientId={selectedClient} />
              </Route>
              <Route path="/transacoes">
                <Transacoes clientId={selectedClient} />
              </Route>
              <Route path="/investimentos">
                <Investimentos clientId={selectedClient} />
              </Route>
              <Route path="/relatorios">
                <Relatorios clientId={selectedClient} />
              </Route>
              <Route path="/open-finance">
                <OpenFinancePage />
              </Route>
              <Route path="/configuracoes">
                <Configuracoes
                  clientId={selectedClient}
                  clientType={currentClient?.type || null}
                />
              </Route>
              <Route path="/pj/dashboard">
                <DashboardPJ
                  clientId={selectedClient}
                  clientType={currentClient?.type || null}
                  bankAccountId={selectedBankAccountId}
                />
              </Route>
              <Route path="/pj/vendas">
                <VendasPJ
                  clientId={selectedClient}
                  clientType={currentClient?.type || null}
                  bankAccountId={selectedBankAccountId}
                />
              </Route>
              <Route path="/pj/conciliacao">
                <ConciliacaoPJ
                  clientId={selectedClient}
                  clientType={currentClient?.type || null}
                  bankAccountId={selectedBankAccountId}
                />
              </Route>
              <Route path="/pj/regras">
                <RegrasPJ
                  clientId={selectedClient}
                  clientType={currentClient?.type || null}
                  bankAccountId={selectedBankAccountId}
                />
              </Route>
              <Route path="/pj/relatorios">
                <RelatoriosPJ
                  clientId={selectedClient}
                  clientType={currentClient?.type || null}
                  bankAccountId={selectedBankAccountId}
                />
              </Route>
              <Route path="/admin/associacoes">
                <AdminAssociacoes />
              </Route>
              <Route path="/admin/auditoria">
                <AdminAuditoria />
              </Route>
            </Switch>
          </div>
        </main>
      </div>
      {user?.role === "master" && (
        <NewClientDialog
          open={newClientDialogOpen}
          onOpenChange={setNewClientDialogOpen}
          onClientCreated={setSelectedClient}
        />
      )}
    </div>
  );
}

export default function App() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider defaultTheme="light">
          <TooltipProvider>
            <SidebarProvider style={style as React.CSSProperties}>
              <Router />
            </SidebarProvider>
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
