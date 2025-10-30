import { createContext, useContext, useMemo } from "react";
import type { PJService } from "@/services/pj";
import { apiPJService } from "@/services/pj";

interface PJServiceProviderProps {
  service?: PJService;
  children: React.ReactNode;
}

const PJServiceContext = createContext<PJService | null>(null);

export function PJServiceProvider({ service, children }: PJServiceProviderProps) {
  const value = useMemo(() => service ?? apiPJService, [service]);

  return <PJServiceContext.Provider value={value}>{children}</PJServiceContext.Provider>;
}

export function usePJService() {
  const ctx = useContext(PJServiceContext);
  if (!ctx) {
    throw new Error("usePJService must be used within a PJServiceProvider");
  }
  return ctx;
}
