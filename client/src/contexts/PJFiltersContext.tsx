import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { PJBankAccount } from "@/services/pj";

export type PJDateRange = {
  from?: string;
  to?: string;
};

export type PJBankAccountOption = PJBankAccount & {
  isAggregate?: boolean;
};

export const ALL_PJ_BANK_ACCOUNTS_OPTION: PJBankAccountOption = {
  id: "__all__",
  bankName: "Todas as Contas",
  accountNumberMask: "Visão consolidada",
  accountType: "aggregate",
  currency: "BRL",
  isActive: true,
  isAggregate: true,
};

export interface PJFiltersContextValue {
  clientId: string | null;
  setClientId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedAccountId: string | null;
  setSelectedAccountId: React.Dispatch<React.SetStateAction<string | null>>;
  dateRange: PJDateRange;
  setDateRange: React.Dispatch<React.SetStateAction<PJDateRange>>;
  allAccountsOption: PJBankAccountOption;
}

const PJFiltersContext = createContext<PJFiltersContextValue | null>(null);

interface PJFiltersProviderProps {
  children: React.ReactNode;
}

export function PJFiltersProvider({ children }: PJFiltersProviderProps) {
  const [clientId, setClientId] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<PJDateRange>({});

  useEffect(() => {
    setSelectedAccountId(null);
    setDateRange({});
  }, [clientId]);

  const value = useMemo<PJFiltersContextValue>(
    () => ({
      clientId,
      setClientId,
      selectedAccountId,
      setSelectedAccountId,
      dateRange,
      setDateRange,
      allAccountsOption: ALL_PJ_BANK_ACCOUNTS_OPTION,
    }),
    [clientId, selectedAccountId, dateRange],
  );

  return <PJFiltersContext.Provider value={value}>{children}</PJFiltersContext.Provider>;
}

export function usePJFilters() {
  const context = useContext(PJFiltersContext);

  if (!context) {
    throw new Error("usePJFilters must be used within a PJFiltersProvider");
  }

  return context;
}
