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
import ResumoPJ from "@/pages/pj/resumo";
import TransacoesPJ from "@/pages/pj/transacoes";
import RelatoriosPJ from "@/pages/pj/relatorios";
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
import { PJFiltersProvider, usePJFilters } from "@/contexts/PJFiltersContext";
import { PJServiceProvider } from "@/contexts/PJServiceContext";
import { usePJBankAccounts } from "@/hooks/usePJBankAccounts";

type PJPageProps = {
  clientId: string | null;
  clientType: string | null;
  bankAccountId: string | null;
};

type PJRouteEntry = {
  path: string;
  component: (props: PJPageProps) => JSX.Element;
};

export const pjRouteEntries: PJRouteEntry[] = [
  { path: "/pj/dashboard", component: DashboardPJ },
  { path: "/pj/resumo", component: ResumoPJ },
  { path: "/pj/transacoes", component: TransacoesPJ },
  { path: "/pj/relatorios", component: RelatoriosPJ },
];

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
  const [newClientDialogOpen, setNewClientDialogOpen] = useState(false);
  const { user } = useAuth();
  const {
    clientId,
    setClientId,
    selectedAccountId,
    setSelectedAccountId,
    allAccountsOption,
  } = usePJFilters();
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
      if (clientId !== null) {
        setClientId(null);
      }
      return;
    }

    if (!clientId || !filteredClients.some((client) => client.clientId === clientId)) {
      setClientId(filteredClients[0].clientId);
    }
  }, [filteredClients, clientId, setClientId]);

  const currentClient = filteredClients.find((c) => c.clientId === clientId) ?? null;
  const isPJClient = currentClient?.type === "PJ" || currentClient?.type === "BOTH";

  const { options: bankAccountOptions, isLoading: isLoadingBankAccounts } = usePJBankAccounts({
    clientId,
    enabled: isPJClient,
  });

  const selectedBankAccount = useMemo(() => {
    return (
      bankAccountOptions.find((account) => account.id === selectedAccountId) ?? null
    );
  }, [bankAccountOptions, selectedAccountId]);

  useEffect(() => {
    if (!isPJClient) {
      setSelectedAccountId(null);
      return;
    }

    if (!bankAccountOptions.length) {
      setSelectedAccountId(null);
      return;
    }

    setSelectedAccountId((current) => {
      if (current && bankAccountOptions.some((account) => account.id === current)) {
        return current;
      }

      const aggregateOption = bankAccountOptions.find(
        (account) => account.id === allAccountsOption.id,
      );

      if (aggregateOption) {
        return aggregateOption.id;
      }

      return bankAccountOptions[0].id;
    });
  }, [allAccountsOption.id, bankAccountOptions, isPJClient, setSelectedAccountId]);

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
              selectedClient={clientId}
              onSelectClient={(nextClientId) => setClientId(nextClientId)}
              onNewClient={user?.role === "master" ? () => setNewClientDialogOpen(true) : undefined}
            />
            {isPJClient && (
              <div className="flex flex-col gap-1">
                <span className="text-[0.65rem] uppercase text-muted-foreground">Conta PJ</span>
                <Select
                  value={selectedAccountId ?? undefined}
                  onValueChange={setSelectedAccountId}
                  disabled={isLoadingBankAccounts || !bankAccountOptions.length}
                >
                  <SelectTrigger className="w-[260px] text-left" data-testid="select-bank-account">
                    <SelectValue placeholder="Selecione uma conta PJ">
                      {selectedBankAccount ? (
                        <div className="flex flex-col">
                          <span className="font-medium">{selectedBankAccount.bankName}</span>
                          <span className="text-xs text-muted-foreground">
                            {selectedBankAccount.isAggregate
                              ? selectedBankAccount.accountNumberMask
                              : `${selectedBankAccount.accountType} • ${selectedBankAccount.accountNumberMask}`}
                          </span>
                        </div>
                      ) : null}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {bankAccountOptions.length ? (
                      bankAccountOptions.map((account) => (
                        <SelectItem
                          key={account.id}
                          value={account.id}
                          textValue={`${account.bankName} ${account.accountNumberMask}`}
                        >
                          <div className="flex flex-col">
                            <span className="font-medium">{account.bankName}</span>
                            <span className="text-xs text-muted-foreground">
                              {account.isAggregate
                                ? account.accountNumberMask
                                : `${account.accountType} • ${account.accountNumberMask}`}
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
              </div>
            )}
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6 md:p-8">
          <div className="max-w-7xl mx-auto">
            <Switch>
              <Route path="/">
                <Dashboard clientId={clientId} />
              </Route>
              <Route path="/transacoes">
                <Transacoes clientId={clientId} />
              </Route>
              <Route path="/investimentos">
                <Investimentos clientId={clientId} />
              </Route>
              <Route path="/relatorios">
                <Relatorios clientId={clientId} />
              </Route>
              <Route path="/open-finance">
                <OpenFinancePage />
              </Route>
              <Route path="/configuracoes">
                <Configuracoes
                  clientId={clientId}
                  clientType={currentClient?.type || null}
                />
              </Route>
              {pjRouteEntries.map(({ path, component: Component }) => (
                <Route key={path} path={path}>
                  <Component
                    clientId={clientId}
                    clientType={currentClient?.type || null}
                    bankAccountId={selectedAccountId}
                  />
                </Route>
              ))}
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
          onClientCreated={(newClientId) => setClientId(newClientId)}
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
      <PJFiltersProvider>
        <PJServiceProvider>
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
        </PJServiceProvider>
      </PJFiltersProvider>
    </QueryClientProvider>
  );
}
