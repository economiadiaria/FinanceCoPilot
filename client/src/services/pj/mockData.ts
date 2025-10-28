export interface BankAccountSummary {
  id: string;
  clientIds?: string[];
  bankName: string;
  accountNumberMask: string;
  accountType: string;
  currency: string;
  isActive: boolean;
}

export const mockBankAccounts: BankAccountSummary[] = [
  {
    id: "acc-bb-001",
    clientIds: ["pj-client-1", "client-1"],
    bankName: "Banco do Brasil",
    accountNumberMask: "***-***-1234",
    accountType: "Conta Corrente",
    currency: "BRL",
    isActive: true,
  },
  {
    id: "acc-itau-002",
    clientIds: ["pj-client-2", "client-2"],
    bankName: "Itaú",
    accountNumberMask: "***-***-5678",
    accountType: "Conta Corrente",
    currency: "BRL",
    isActive: true,
  },
  {
    id: "acc-sicredi-003",
    clientIds: ["pj-client-1"],
    bankName: "Sicredi",
    accountNumberMask: "***-***-9012",
    accountType: "Conta Empresarial",
    currency: "BRL",
    isActive: false,
  },
  {
    id: "acc-nubank-004",
    bankName: "Nubank PJ",
    accountNumberMask: "***-***-3456",
    accountType: "Conta Digital",
    currency: "BRL",
    isActive: true,
  },
];
