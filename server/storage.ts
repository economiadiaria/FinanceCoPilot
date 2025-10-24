import type { Client, Transaction, Position, PFPolicy, PJPolicy, Report } from "@shared/schema";
import Database from "@replit/database";

export interface IStorage {
  // Clients
  getClients(): Promise<Client[]>;
  getClient(clientId: string): Promise<Client | undefined>;
  upsertClient(client: Client): Promise<Client>;

  // Transactions
  getTransactions(clientId: string): Promise<Transaction[]>;
  setTransactions(clientId: string, transactions: Transaction[]): Promise<void>;
  addTransactions(clientId: string, transactions: Transaction[]): Promise<void>;

  // Positions
  getPositions(clientId: string): Promise<Position[]>;
  setPositions(clientId: string, positions: Position[]): Promise<void>;
  addPosition(clientId: string, position: Position): Promise<void>;

  // Policies
  getPolicy(clientId: string): Promise<PFPolicy | PJPolicy | null>;
  setPolicy(clientId: string, policy: PFPolicy | PJPolicy): Promise<void>;

  // Reports
  getReport(clientId: string, period: string): Promise<Report | null>;
  setReport(clientId: string, period: string, report: Report): Promise<void>;
  getReportHtml(clientId: string, period: string): Promise<string | null>;
  setReportHtml(clientId: string, period: string, html: string): Promise<void>;
}

export class MemStorage implements IStorage {
  private clients: Map<string, Client>;
  private transactions: Map<string, Transaction[]>;
  private positions: Map<string, Position[]>;
  private policies: Map<string, PFPolicy | PJPolicy>;
  private reports: Map<string, Map<string, Report>>;
  private reportHtmls: Map<string, Map<string, string>>;

  constructor() {
    this.clients = new Map();
    this.transactions = new Map();
    this.positions = new Map();
    this.policies = new Map();
    this.reports = new Map();
    this.reportHtmls = new Map();
  }

  // Clients
  async getClients(): Promise<Client[]> {
    return Array.from(this.clients.values());
  }

  async getClient(clientId: string): Promise<Client | undefined> {
    return this.clients.get(clientId);
  }

  async upsertClient(client: Client): Promise<Client> {
    this.clients.set(client.clientId, client);
    return client;
  }

  // Transactions
  async getTransactions(clientId: string): Promise<Transaction[]> {
    return this.transactions.get(clientId) || [];
  }

  async setTransactions(clientId: string, transactions: Transaction[]): Promise<void> {
    this.transactions.set(clientId, transactions);
  }

  async addTransactions(clientId: string, newTransactions: Transaction[]): Promise<void> {
    const existing = await this.getTransactions(clientId);
    this.transactions.set(clientId, [...existing, ...newTransactions]);
  }

  // Positions
  async getPositions(clientId: string): Promise<Position[]> {
    return this.positions.get(clientId) || [];
  }

  async setPositions(clientId: string, positions: Position[]): Promise<void> {
    this.positions.set(clientId, positions);
  }

  async addPosition(clientId: string, position: Position): Promise<void> {
    const existing = await this.getPositions(clientId);
    this.positions.set(clientId, [...existing, position]);
  }

  // Policies
  async getPolicy(clientId: string): Promise<PFPolicy | PJPolicy | null> {
    return this.policies.get(clientId) || null;
  }

  async setPolicy(clientId: string, policy: PFPolicy | PJPolicy): Promise<void> {
    this.policies.set(clientId, policy);
  }

  // Reports
  async getReport(clientId: string, period: string): Promise<Report | null> {
    const clientReports = this.reports.get(clientId);
    return clientReports?.get(period) || null;
  }

  async setReport(clientId: string, period: string, report: Report): Promise<void> {
    if (!this.reports.has(clientId)) {
      this.reports.set(clientId, new Map());
    }
    this.reports.get(clientId)!.set(period, report);
  }

  async getReportHtml(clientId: string, period: string): Promise<string | null> {
    const clientHtmls = this.reportHtmls.get(clientId);
    return clientHtmls?.get(period) || null;
  }

  async setReportHtml(clientId: string, period: string, html: string): Promise<void> {
    if (!this.reportHtmls.has(clientId)) {
      this.reportHtmls.set(clientId, new Map());
    }
    this.reportHtmls.get(clientId)!.set(period, html);
  }
}

export class ReplitDbStorage implements IStorage {
  private db: Database;

  constructor() {
    this.db = new Database();
  }

  // Clients - Use individual keys to avoid concurrency issues
  async getClients(): Promise<Client[]> {
    const listResult = await this.db.get("client_list");
    // 404 means key doesn't exist, which is fine (empty database)
    if (!listResult.ok && listResult.error.statusCode !== 404) {
      throw new Error(`Database error getting client list: ${listResult.error?.message || JSON.stringify(listResult.error)}`);
    }
    const clientIds: string[] = listResult.ok ? (listResult.value ?? []) : [];
    
    const clients: Client[]  = [];
    for (const clientId of clientIds) {
      const client = await this.getClient(clientId);
      if (client) {
        clients.push(client);
      }
    }
    return clients;
  }

  async getClient(clientId: string): Promise<Client | undefined> {
    const result = await this.db.get(`client:${clientId}`);
    // 404 means key doesn't exist, which is fine (client not found)
    if (!result.ok && result.error.statusCode !== 404) {
      throw new Error(`Database error getting client ${clientId}: ${result.error?.message || JSON.stringify(result.error)}`);
    }
    return result.ok ? (result.value ?? undefined) : undefined;
  }

  async upsertClient(client: Client): Promise<Client> {
    // Save the client with individual key
    const setResult = await this.db.set(`client:${client.clientId}`, client);
    if (!setResult.ok) {
      throw new Error(`Database error upserting client: ${setResult.error?.message || JSON.stringify(setResult.error)}`);
    }
    
    // Add to client list if new
    const listResult = await this.db.get("client_list");
    // 404 means client_list doesn't exist yet (first client being added)
    if (!listResult.ok && listResult.error.statusCode !== 404) {
      throw new Error(`Database error getting client list: ${listResult.error?.message || JSON.stringify(listResult.error)}`);
    }
    const clientIds: string[] = listResult.ok ? (listResult.value ?? []) : [];
    
    if (!clientIds.includes(client.clientId)) {
      clientIds.push(client.clientId);
      const updateListResult = await this.db.set("client_list", clientIds);
      if (!updateListResult.ok) {
        throw new Error(`Database error updating client list: ${updateListResult.error?.message || JSON.stringify(updateListResult.error)}`);
      }
    }
    
    return client;
  }

  // Transactions
  async getTransactions(clientId: string): Promise<Transaction[]> {
    const result = await this.db.get(`transactions:${clientId}`);
    // 404 means key doesn't exist (no transactions yet)
    if (!result.ok && result.error.statusCode !== 404) {
      throw new Error(`Database error getting transactions for ${clientId}: ${result.error?.message || JSON.stringify(result.error)}`);
    }
    return result.ok ? (result.value ?? []) : [];
  }

  async setTransactions(clientId: string, transactions: Transaction[]): Promise<void> {
    const result = await this.db.set(`transactions:${clientId}`, transactions);
    if (!result.ok) {
      throw new Error(`Database error setting transactions for ${clientId}: ${result.error.message}`);
    }
  }

  async addTransactions(clientId: string, newTransactions: Transaction[]): Promise<void> {
    const existing = await this.getTransactions(clientId);
    await this.setTransactions(clientId, [...existing, ...newTransactions]);
  }

  // Positions
  async getPositions(clientId: string): Promise<Position[]> {
    const result = await this.db.get(`positions:${clientId}`);
    // 404 means key doesn't exist (no positions yet)
    if (!result.ok && result.error.statusCode !== 404) {
      throw new Error(`Database error getting positions for ${clientId}: ${result.error?.message || JSON.stringify(result.error)}`);
    }
    return result.ok ? (result.value ?? []) : [];
  }

  async setPositions(clientId: string, positions: Position[]): Promise<void> {
    const result = await this.db.set(`positions:${clientId}`, positions);
    if (!result.ok) {
      throw new Error(`Database error setting positions for ${clientId}: ${result.error.message}`);
    }
  }

  async addPosition(clientId: string, position: Position): Promise<void> {
    const existing = await this.getPositions(clientId);
    await this.setPositions(clientId, [...existing, position]);
  }

  // Policies
  async getPolicy(clientId: string): Promise<PFPolicy | PJPolicy | null> {
    const result = await this.db.get(`policy:${clientId}`);
    // 404 means key doesn't exist (no policy set)
    if (!result.ok && result.error.statusCode !== 404) {
      throw new Error(`Database error getting policy for ${clientId}: ${result.error?.message || JSON.stringify(result.error)}`);
    }
    return result.ok ? (result.value ?? null) : null;
  }

  async setPolicy(clientId: string, policy: PFPolicy | PJPolicy): Promise<void> {
    const result = await this.db.set(`policy:${clientId}`, policy);
    if (!result.ok) {
      throw new Error(`Database error setting policy for ${clientId}: ${result.error.message}`);
    }
  }

  // Reports
  async getReport(clientId: string, period: string): Promise<Report | null> {
    const result = await this.db.get(`report:${clientId}:${period}`);
    // 404 means key doesn't exist (no report for this period)
    if (!result.ok && result.error.statusCode !== 404) {
      throw new Error(`Database error getting report for ${clientId}:${period}: ${result.error?.message || JSON.stringify(result.error)}`);
    }
    return result.ok ? (result.value ?? null) : null;
  }

  async setReport(clientId: string, period: string, report: Report): Promise<void> {
    const result = await this.db.set(`report:${clientId}:${period}`, report);
    if (!result.ok) {
      throw new Error(`Database error setting report for ${clientId}:${period}: ${result.error?.message || JSON.stringify(result.error)}`);
    }
  }

  async getReportHtml(clientId: string, period: string): Promise<string | null> {
    const result = await this.db.get(`reportHtml:${clientId}:${period}`);
    // 404 means key doesn't exist (no HTML for this period)
    if (!result.ok && result.error.statusCode !== 404) {
      throw new Error(`Database error getting report HTML for ${clientId}:${period}: ${result.error?.message || JSON.stringify(result.error)}`);
    }
    return result.ok ? (result.value ?? null) : null;
  }

  async setReportHtml(clientId: string, period: string, html: string): Promise<void> {
    const result = await this.db.set(`reportHtml:${clientId}:${period}`, html);
    if (!result.ok) {
      throw new Error(`Database error setting report HTML for ${clientId}:${period}: ${result.error?.message || JSON.stringify(result.error)}`);
    }
  }
}

// Use ReplitDbStorage by default for persistence
export const storage = new ReplitDbStorage();
