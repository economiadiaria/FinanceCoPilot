import { getPJBankingAPI } from "./pjBanking.gen";
import type {
  GetApiPjSummaryParams,
  GetApiPjTransactionsParams,
} from "./model";
export type {
  AccountsResponse,
  BankTransactionListResponse,
  GetApiPjSummaryParams,
  GetApiPjTransactionsParams,
  SummaryResponse,
} from "./model";

export type TransactionsQuery = Partial<GetApiPjTransactionsParams>;
export type SummaryQuery = Partial<GetApiPjSummaryParams>;

const pjBankingApi = getPJBankingAPI();

export async function listAccounts() {
  const response = await pjBankingApi.getApiPjAccounts();
  return response.data;
}

export async function listTransactions(params: TransactionsQuery) {
  const response = await pjBankingApi.getApiPjTransactions(
    params as GetApiPjTransactionsParams,
  );
  return response.data;
}

export async function getSummary(params: SummaryQuery) {
  const response = await pjBankingApi.getApiPjSummary(
    params as GetApiPjSummaryParams,
  );
  return response.data;
}

export { getPJBankingAPI };
