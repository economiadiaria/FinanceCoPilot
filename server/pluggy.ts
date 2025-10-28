import axios, { AxiosInstance } from "axios";
import { logger } from "./observability/logger";

// Pluggy configuration from environment
const PLUGGY_API_URL = process.env.PLUGGY_API_URL || "";
const PLUGGY_CLIENT_ID = process.env.PLUGGY_CLIENT_ID || "";
const PLUGGY_CLIENT_SECRET = process.env.PLUGGY_CLIENT_SECRET || "";

export const hasPluggyCredentials = () => {
  return !!(PLUGGY_API_URL && PLUGGY_CLIENT_ID && PLUGGY_CLIENT_SECRET);
};

// Pluggy API client
class PluggyClient {
  private client: AxiosInstance | null = null;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor() {
    if (hasPluggyCredentials()) {
      this.client = axios.create({
        baseURL: PLUGGY_API_URL,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }
  }

  // Check if client is available
  isAvailable(): boolean {
    return this.client !== null;
  }

  // Authenticate and get access token
  private async authenticate(): Promise<void> {
    if (!this.client) throw new Error("Pluggy client not initialized");

    // Check if token is still valid
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return;
    }

    try {
      const response = await this.client.post("/auth", {
        clientId: PLUGGY_CLIENT_ID,
        clientSecret: PLUGGY_CLIENT_SECRET,
      });

      this.accessToken = response.data.accessToken;
      // Token typically expires in 1 hour, refresh 5 mins before
      this.tokenExpiresAt = Date.now() + (55 * 60 * 1000);
    } catch (error: any) {
      logger.error("Pluggy authentication failed", {
        event: "pluggy.auth",
        context: { status: error.response?.status },
      }, error);
      throw new Error("Failed to authenticate with Pluggy");
    }
  }

  // Create connect token for widget
  async createConnectToken(clientUserId: string): Promise<string> {
    if (!this.client) throw new Error("Pluggy client not initialized");

    await this.authenticate();

    try {
      const response = await this.client.post(
        "/connect_token",
        {
          clientUserId,
          options: {
            products: ["ACCOUNTS", "TRANSACTIONS", "INVESTMENTS"],
          },
        },
        {
          headers: {
            "X-API-KEY": this.accessToken,
          },
        }
      );

      return response.data.accessToken;
    } catch (error: any) {
      logger.error("Failed to create connect token", {
        event: "pluggy.connect-token",
        context: { clientUserId, status: error.response?.status },
      }, error);
      throw new Error("Failed to create connect token");
    }
  }

  // Get item details
  async getItem(itemId: string) {
    if (!this.client) throw new Error("Pluggy client not initialized");

    await this.authenticate();

    try {
      const response = await this.client.get(`/items/${itemId}`, {
        headers: {
          "X-API-KEY": this.accessToken,
        },
      });

      return response.data;
    } catch (error: any) {
      logger.error("Failed to get pluggy item", {
        event: "pluggy.item",
        context: { itemId, status: error.response?.status },
      }, error);
      throw new Error(`Failed to get item ${itemId}`);
    }
  }

  // Get accounts for an item
  async getAccounts(itemId: string) {
    if (!this.client) throw new Error("Pluggy client not initialized");

    await this.authenticate();

    try {
      const response = await this.client.get(`/items/${itemId}/accounts`, {
        headers: {
          "X-API-KEY": this.accessToken,
        },
      });

      return response.data.results || [];
    } catch (error: any) {
      logger.error("Failed to get pluggy accounts", {
        event: "pluggy.accounts",
        context: { itemId, status: error.response?.status },
      }, error);
      throw new Error(`Failed to get accounts for item ${itemId}`);
    }
  }

  // Get transactions for an account
  async getTransactions(accountId: string, from?: string) {
    if (!this.client) throw new Error("Pluggy client not initialized");

    await this.authenticate();

    try {
      const params: any = {
        pageSize: 500, // Max per request
      };

      if (from) {
        params.from = from;
      }

      const response = await this.client.get(`/accounts/${accountId}/transactions`, {
        headers: {
          "X-API-KEY": this.accessToken,
        },
        params,
      });

      return response.data.results || [];
    } catch (error: any) {
      logger.error("Failed to get pluggy transactions", {
        event: "pluggy.transactions",
        context: { accountId, status: error.response?.status },
      }, error);
      throw new Error(`Failed to get transactions for account ${accountId}`);
    }
  }

  // Get investment positions for an account
  async getInvestments(accountId: string) {
    if (!this.client) throw new Error("Pluggy client not initialized");

    await this.authenticate();

    try {
      const response = await this.client.get(`/accounts/${accountId}/investments`, {
        headers: {
          "X-API-KEY": this.accessToken,
        },
      });

      return response.data.results || [];
    } catch (error: any) {
      logger.error("Failed to get pluggy investments", {
        event: "pluggy.investments",
        context: { accountId, status: error.response?.status },
      }, error);
      // Not all accounts have investments, return empty array
      return [];
    }
  }
}

export const pluggyClient = new PluggyClient();
