import type { Client, Transaction, Position, PFPolicy, PJPolicy, Report } from "@shared/schema";

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

export const storage = new MemStorage();
