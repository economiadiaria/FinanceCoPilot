import type { Client, Transaction, Position, PFPolicy, PJPolicy, Report, User, OFXImport, OFItem, OFAccount, OFSyncMeta } from "@shared/schema";
import Database from "@replit/database";

export interface IStorage {
  // Users
  getUsers(): Promise<User[]>;
  getUserById(userId: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: User): Promise<User>;
  updateUser(userId: string, updates: Partial<User>): Promise<User>;

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

  // OFX Imports
  getOFXImport(fileHash: string): Promise<OFXImport | null>;
  addOFXImport(ofxImport: OFXImport): Promise<void>;

  // Open Finance (Pluggy)
  getOFItems(clientId: string): Promise<OFItem[]>;
  setOFItems(clientId: string, items: OFItem[]): Promise<void>;
  addOFItem(clientId: string, item: OFItem): Promise<void>;
  
  getOFAccounts(clientId: string): Promise<OFAccount[]>;
  setOFAccounts(clientId: string, accounts: OFAccount[]): Promise<void>;
  
  getOFSyncMeta(clientId: string): Promise<OFSyncMeta | null>;
  setOFSyncMeta(clientId: string, meta: OFSyncMeta): Promise<void>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private clients: Map<string, Client>;
  private transactions: Map<string, Transaction[]>;
  private positions: Map<string, Position[]>;
  private policies: Map<string, PFPolicy | PJPolicy>;
  private reports: Map<string, Map<string, Report>>;
  private reportHtmls: Map<string, Map<string, string>>;
  private ofxImports: Map<string, OFXImport>;
  private ofItems: Map<string, OFItem[]>;
  private ofAccounts: Map<string, OFAccount[]>;
  private ofSyncMeta: Map<string, OFSyncMeta>;

  constructor() {
    this.users = new Map();
    this.clients = new Map();
    this.transactions = new Map();
    this.positions = new Map();
    this.policies = new Map();
    this.reports = new Map();
    this.reportHtmls = new Map();
    this.ofxImports = new Map();
    this.ofItems = new Map();
    this.ofAccounts = new Map();
    this.ofSyncMeta = new Map();
  }

  // Users
  async getUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async getUserById(userId: string): Promise<User | undefined> {
    return this.users.get(userId);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(u => u.email === email);
  }

  async createUser(user: User): Promise<User> {
    this.users.set(user.userId, user);
    return user;
  }

  async updateUser(userId: string, updates: Partial<User>): Promise<User> {
    const existing = this.users.get(userId);
    if (!existing) {
      throw new Error(`User ${userId} not found`);
    }
    const updated = { ...existing, ...updates };
    this.users.set(userId, updated);
    return updated;
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

  // OFX Imports
  async getOFXImport(fileHash: string): Promise<OFXImport | null> {
    return this.ofxImports.get(fileHash) || null;
  }

  async addOFXImport(ofxImport: OFXImport): Promise<void> {
    this.ofxImports.set(ofxImport.fileHash, ofxImport);
  }

  // Open Finance (Pluggy)
  async getOFItems(clientId: string): Promise<OFItem[]> {
    return this.ofItems.get(clientId) || [];
  }

  async setOFItems(clientId: string, items: OFItem[]): Promise<void> {
    this.ofItems.set(clientId, items);
  }

  async addOFItem(clientId: string, item: OFItem): Promise<void> {
    const existing = await this.getOFItems(clientId);
    this.ofItems.set(clientId, [...existing, item]);
  }

  async getOFAccounts(clientId: string): Promise<OFAccount[]> {
    return this.ofAccounts.get(clientId) || [];
  }

  async setOFAccounts(clientId: string, accounts: OFAccount[]): Promise<void> {
    this.ofAccounts.set(clientId, accounts);
  }

  async getOFSyncMeta(clientId: string): Promise<OFSyncMeta | null> {
    return this.ofSyncMeta.get(clientId) || null;
  }

  async setOFSyncMeta(clientId: string, meta: OFSyncMeta): Promise<void> {
    this.ofSyncMeta.set(clientId, meta);
  }
}

export class ReplitDbStorage implements IStorage {
  private db: Database;

  constructor() {
    this.db = new Database();
  }

  // Users - Use individual keys to avoid concurrency issues
  async getUsers(): Promise<User[]> {
    const listResult = await this.db.get("user_list");
    // 404 means key doesn't exist (no users yet)
    if (!listResult.ok && listResult.error.statusCode !== 404) {
      throw new Error(`Database error getting user list: ${listResult.error?.message || JSON.stringify(listResult.error)}`);
    }
    const userIds: string[] = listResult.ok ? (listResult.value ?? []) : [];
    
    const users: User[] = [];
    for (const userId of userIds) {
      const user = await this.getUserById(userId);
      if (user) {
        users.push(user);
      }
    }
    return users;
  }

  async getUserById(userId: string): Promise<User | undefined> {
    const result = await this.db.get(`user:${userId}`);
    // 404 means key doesn't exist (user not found)
    if (!result.ok && result.error?.statusCode !== 404) {
      throw new Error(`Database error getting user ${userId}: ${result.error?.message || JSON.stringify(result.error)}`);
    }
    return result.ok ? (result.value ?? undefined) : undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const users = await this.getUsers();
    return users.find(u => u.email === email);
  }

  async createUser(user: User): Promise<User> {
    // Save the user with individual key
    const setResult = await this.db.set(`user:${user.userId}`, user);
    if (!setResult.ok) {
      throw new Error(`Database error creating user: ${setResult.error?.message || JSON.stringify(setResult.error)}`);
    }
    
    // Add to user list if new
    const listResult = await this.db.get("user_list");
    // 404 means user_list doesn't exist yet (first user being added)
    if (!listResult.ok && listResult.error.statusCode !== 404) {
      throw new Error(`Database error getting user list: ${listResult.error?.message || JSON.stringify(listResult.error)}`);
    }
    const userIds: string[] = listResult.ok ? (listResult.value ?? []) : [];
    
    if (!userIds.includes(user.userId)) {
      userIds.push(user.userId);
      const updateListResult = await this.db.set("user_list", userIds);
      if (!updateListResult.ok) {
        throw new Error(`Database error updating user list: ${updateListResult.error?.message || JSON.stringify(updateListResult.error)}`);
      }
    }
    
    return user;
  }

  async updateUser(userId: string, updates: Partial<User>): Promise<User> {
    const existing = await this.getUserById(userId);
    if (!existing) {
      throw new Error(`User ${userId} not found`);
    }
    const updated = { ...existing, ...updates };
    const setResult = await this.db.set(`user:${userId}`, updated);
    if (!setResult.ok) {
      throw new Error(`Database error updating user: ${setResult.error?.message || JSON.stringify(setResult.error)}`);
    }
    return updated;
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
    if (!result.ok && result.error?.statusCode !== 404) {
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
    if (!result.ok && result.error?.statusCode !== 404) {
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
    if (!result.ok && result.error?.statusCode !== 404) {
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
    if (!result.ok && result.error?.statusCode !== 404) {
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
    if (!result.ok && result.error?.statusCode !== 404) {
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
    if (!result.ok && result.error?.statusCode !== 404) {
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

  // OFX Imports
  async getOFXImport(fileHash: string): Promise<OFXImport | null> {
    const result = await this.db.get(`ofxImport:${fileHash}`);
    // 404 means key doesn't exist (file not imported before)
    if (!result.ok && result.error?.statusCode !== 404) {
      throw new Error(`Database error getting OFX import ${fileHash}: ${result.error?.message || JSON.stringify(result.error)}`);
    }
    return result.ok ? (result.value ?? null) : null;
  }

  async addOFXImport(ofxImport: OFXImport): Promise<void> {
    const result = await this.db.set(`ofxImport:${ofxImport.fileHash}`, ofxImport);
    if (!result.ok) {
      throw new Error(`Database error adding OFX import: ${result.error?.message || JSON.stringify(result.error)}`);
    }
  }

  // Open Finance (Pluggy)
  async getOFItems(clientId: string): Promise<OFItem[]> {
    const result = await this.db.get(`of_items:${clientId}`);
    if (!result.ok && result.error?.statusCode !== 404) {
      throw new Error(`Database error getting OF items for ${clientId}: ${result.error?.message || JSON.stringify(result.error)}`);
    }
    return result.ok ? (result.value ?? []) : [];
  }

  async setOFItems(clientId: string, items: OFItem[]): Promise<void> {
    const result = await this.db.set(`of_items:${clientId}`, items);
    if (!result.ok) {
      throw new Error(`Database error setting OF items for ${clientId}: ${result.error.message}`);
    }
  }

  async addOFItem(clientId: string, item: OFItem): Promise<void> {
    const existing = await this.getOFItems(clientId);
    await this.setOFItems(clientId, [...existing, item]);
  }

  async getOFAccounts(clientId: string): Promise<OFAccount[]> {
    const result = await this.db.get(`of_accounts:${clientId}`);
    if (!result.ok && result.error?.statusCode !== 404) {
      throw new Error(`Database error getting OF accounts for ${clientId}: ${result.error?.message || JSON.stringify(result.error)}`);
    }
    return result.ok ? (result.value ?? []) : [];
  }

  async setOFAccounts(clientId: string, accounts: OFAccount[]): Promise<void> {
    const result = await this.db.set(`of_accounts:${clientId}`, accounts);
    if (!result.ok) {
      throw new Error(`Database error setting OF accounts for ${clientId}: ${result.error.message}`);
    }
  }

  async getOFSyncMeta(clientId: string): Promise<OFSyncMeta | null> {
    const result = await this.db.get(`of_sync_meta:${clientId}`);
    if (!result.ok && result.error?.statusCode !== 404) {
      throw new Error(`Database error getting OF sync meta for ${clientId}: ${result.error?.message || JSON.stringify(result.error)}`);
    }
    return result.ok ? (result.value ?? null) : null;
  }

  async setOFSyncMeta(clientId: string, meta: OFSyncMeta): Promise<void> {
    const result = await this.db.set(`of_sync_meta:${clientId}`, meta);
    if (!result.ok) {
      throw new Error(`Database error setting OF sync meta for ${clientId}: ${result.error.message}`);
    }
  }
}

// Use ReplitDbStorage by default for persistence
export const storage = new ReplitDbStorage();
