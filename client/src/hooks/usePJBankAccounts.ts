import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePJService } from "@/contexts/PJServiceContext";
import {
  ALL_PJ_BANK_ACCOUNTS_OPTION,
  type PJBankAccountOption,
} from "@/contexts/PJFiltersContext";
import type { PJBankAccount } from "@/services/pj";

interface UsePJBankAccountsParams {
  clientId: string | null;
  enabled: boolean;
  includeAggregateOption?: boolean;
}

export function usePJBankAccounts({
  clientId,
  enabled,
  includeAggregateOption = true,
}: UsePJBankAccountsParams) {
  const pjService = usePJService();

  const query = useQuery<PJBankAccount[]>({
    queryKey: ["pj:bank-accounts", { clientId }],
    enabled: enabled && !!clientId,
    queryFn: () =>
      pjService.listBankAccounts({
        clientId: clientId!,
      }),
  });

  const accounts = query.data ?? [];

  const options = useMemo<PJBankAccountOption[]>(() => {
    if (!enabled) {
      return [];
    }

    if (!accounts.length) {
      return [];
    }

    if (!includeAggregateOption) {
      return accounts;
    }

    return [ALL_PJ_BANK_ACCOUNTS_OPTION, ...accounts];
  }, [accounts, enabled, includeAggregateOption]);

  return {
    ...query,
    accounts,
    options,
  };
}
