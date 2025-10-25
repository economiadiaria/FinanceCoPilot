import { useState } from "react";
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
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Dashboard from "@/pages/dashboard";
import Transacoes from "@/pages/transacoes";
import Investimentos from "@/pages/investimentos";
import Relatorios from "@/pages/relatorios";
import Configuracoes from "@/pages/configuracoes";
import OpenFinancePage from "@/pages/open-finance";
import LoginPage from "@/pages/login";
import type { Client } from "@shared/schema";

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
  const [newClientDialogOpen, setNewClientDialogOpen] = useState(false);

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const currentClient = clients.find((c) => c.clientId === selectedClient);

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
              clients={clients}
              selectedClient={selectedClient}
              onSelectClient={setSelectedClient}
              onNewClient={() => setNewClientDialogOpen(true)}
            />
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
            </Switch>
          </div>
        </main>
      </div>
      <NewClientDialog
        open={newClientDialogOpen}
        onOpenChange={setNewClientDialogOpen}
        onClientCreated={setSelectedClient}
      />
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
