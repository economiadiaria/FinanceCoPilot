import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  getSummary as fetchSummary,
  listAccounts,
  listTransactions,
  type SummaryQuery,
  type TransactionsQuery,
} from "@financecopilot/pj-banking-sdk";
import { getApiHeaders } from "./api";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: HeadersInit = {
    ...getApiHeaders(),
    ...(data ? { "Content-Type": "application/json" } : {}),
  };

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";

type SdkQueryExecutor = (params: unknown) => Promise<unknown>;

const pjBankingExecutors: Record<string, SdkQueryExecutor> = {
  "/api/pj/accounts": async () => listAccounts(),
  "/api/pj/transactions": async (params) =>
    listTransactions((params ?? {}) as TransactionsQuery),
  "/api/pj/summary": async (params) =>
    fetchSummary((params ?? {}) as SummaryQuery),
};

function formatAxiosError(error: unknown): Error {
  if (!isAxiosError(error)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  const status = error.response?.status;
  if (typeof status === "number") {
    const message =
      typeof error.response?.data === "string"
        ? error.response.data
        : JSON.stringify(error.response?.data ?? error.message);
    return new Error(`${status}: ${message}`);
  }

  return new Error(error.message);
}

export const getQueryFn =
  <T>({
    on401: unauthorizedBehavior,
  }: {
    on401: UnauthorizedBehavior;
  }): QueryFunction<T> =>
  async ({ queryKey }) => {
    // Handle query key construction
    // First element is the base URL, rest are query parameters
    const [baseUrl, ...params] = queryKey;
    const sdkExecutor = pjBankingExecutors[baseUrl as string];

    if (sdkExecutor) {
      try {
        return (await sdkExecutor(params[0])) as T;
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 401) {
          if (unauthorizedBehavior === "returnNull") {
            return null as T;
          }
        }

        throw formatAxiosError(error);
      }
    }

    let url = baseUrl as string;

    // Build query string from remaining parameters
    if (params.length > 0) {
      const queryParams = new URLSearchParams();

      // Handle object parameters (like filters)
      params.forEach((param, index) => {
        if (param && typeof param === "object") {
          Object.entries(param).forEach(([key, value]) => {
            if (value !== null && value !== undefined) {
              queryParams.append(key, String(value));
            }
          });
        } else if (param !== null && param !== undefined) {
          // For simple parameters, use conventional query param names
          if (index === 0) {
            queryParams.append("clientId", String(param));
          } else if (index === 1) {
            queryParams.append("period", String(param));
          } else {
            queryParams.append(`param${index}`, String(param));
          }
        }
      });

      const queryString = queryParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    const res = await fetch(url, {
      headers: getApiHeaders(),
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
