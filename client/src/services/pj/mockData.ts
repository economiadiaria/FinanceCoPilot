export interface BankAccountSummary {
  id: string;
  bankName: string;
  accountNumberMask: string;
  accountType: string;
  currency: string;
  isActive: boolean;
}

export const mockBankAccounts: BankAccountSummary[] = [
  {
    id: "acc-bb-001",
    bankName: "Banco do Brasil",
    accountNumberMask: "***-***-1234",
    accountType: "Conta Corrente",
    currency: "BRL",
    isActive: true,
  },
  {
    id: "acc-itau-002",
    bankName: "Itaú",
    accountNumberMask: "***-***-5678",
    accountType: "Conta Corrente",
    currency: "BRL",
    isActive: true,
  },
  {
    id: "acc-sicredi-003",
    bankName: "Sicredi",
    accountNumberMask: "***-***-9012",
    accountType: "Conta Empresarial",
    currency: "BRL",
    isActive: false,
  },
];
