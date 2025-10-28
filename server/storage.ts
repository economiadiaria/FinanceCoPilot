import type {
  Client,
  Transaction,
  Position,
  PFPolicy,
  PJPolicy,
  Report,
  User,
  OFXImport,
  OFItem,
  OFAccount,
  OFSyncMeta,
  Sale,
  SaleLeg,
  PaymentMethod,
  LedgerEntry,
  BankTransaction,
  CategorizationRule,
  AuditLogEntry,
} from "@shared/schema";
import Database from "@replit/database";

export interface IStorage {
  // Users
  getUsers(): Promise<User[]>;
  getUserById(userId: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: User): Promise<User>;
  updateUser(userId: string, updates: Partial<User>): Promise<User>;
  anonymizeUser(userId: string): Promise<User | undefined>;

  // Clients
  getClients(): Promise<Client[]>;
  getClient(clientId: string): Promise<Client | undefined>;
  upsertClient(client: Client): Promise<Client>;
  anonymizeClient(clientId: string): Promise<Client | undefined>;

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

  // PJ - Sales
  getSales(clientId: string): Promise<Sale[]>;
  setSales(clientId: string, sales: Sale[]): Promise<void>;
  addSale(clientId: string, sale: Sale): Promise<void>;
  
  // PJ - Sale Legs
  getSaleLegs(clientId: string): Promise<SaleLeg[]>;
  setSaleLegs(clientId: string, legs: SaleLeg[]): Promise<void>;
  updateSaleLeg(clientId: string, saleLegId: string, updates: Partial<SaleLeg>): Promise<void>;
  
  // PJ - Payment Methods
  getPaymentMethods(clientId: string): Promise<PaymentMethod[]>;
  setPaymentMethods(clientId: string, methods: PaymentMethod[]): Promise<void>;
  
  // PJ - Ledger
  getLedgerEntries(clientId: string): Promise<LedgerEntry[]>;
  setLedgerEntries(clientId: string, entries: LedgerEntry[]): Promise<void>;
  addLedgerEntry(clientId: string, entry: LedgerEntry): Promise<void>;
  
  // PJ - Bank Transactions
  getBankTransactions(clientId: string): Promise<BankTransaction[]>;
  setBankTransactions(clientId: string, transactions: BankTransaction[]): Promise<void>;
  addBankTransactions(clientId: string, transactions: BankTransaction[]): Promise<void>;
  updateBankTransaction(clientId: string, bankTxId: string, updates: Partial<BankTransaction>): Promise<void>;
  
  // PJ - Categorization Rules
  getCategorizationRules(clientId: string): Promise<CategorizationRule[]>;
  setCategorizationRules(clientId: string, rules: CategorizationRule[]): Promise<void>;
  addCategorizationRule(clientId: string, rule: CategorizationRule): Promise<void>;
  updateCategorizationRule(clientId: string, ruleId: string, updates: Partial<CategorizationRule>): Promise<void>;

  // Audit trail
  recordAudit(entry: AuditLogEntry): Promise<void>;
  getAuditLogs(organizationId: string, limit?: number): Promise<AuditLogEntry[]>;
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
  
  // PJ storage
  private pjSales: Map<string, Sale[]>;
  private pjSaleLegs: Map<string, SaleLeg[]>;
  private pjPaymentMethods: Map<string, PaymentMethod[]>;
  private pjLedgerEntries: Map<string, LedgerEntry[]>;
  private pjBankTransactions: Map<string, BankTransaction[]>;
  private pjCategorizationRules: Map<string, CategorizationRule[]>;
  private auditLogs: Map<string, AuditLogEntry[]>;

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
    
    this.pjSales = new Map();
    this.pjSaleLegs = new Map();
    this.pjPaymentMethods = new Map();
    this.pjLedgerEntries = new Map();
    this.pjBankTransactions = new Map();
    this.pjCategorizationRules = new Map();
    this.auditLogs = new Map();
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

  async anonymizeUser(userId: string): Promise<User | undefined> {
    const existing = this.users.get(userId);
    if (!existing) {
      return undefined;
    }
    const anonymized: User = {
      ...existing,
      name: "Usuário Anonimizado",
      email: `${userId}@anon.finco`,
      passwordHash: existing.passwordHash,
      managerId: undefined,
      consultantId: undefined,
    };
    this.users.set(userId, anonymized);
    return anonymized;
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

  async anonymizeClient(clientId: string): Promise<Client | undefined> {
    const existing = this.clients.get(clientId);
    if (!existing) {
      return undefined;
    }
    const anonymized: Client = {
      ...existing,
      name: "Cliente Anonimizado",
      email: `${clientId}@anon.finco`,
    };
    this.clients.set(clientId, anonymized);
    return anonymized;
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

  // PJ - Sales
  async getSales(clientId: string): Promise<Sale[]> {
    return this.pjSales.get(clientId) || [];
  }

  async setSales(clientId: string, sales: Sale[]): Promise<void> {
    this.pjSales.set(clientId, sales);
  }

  async addSale(clientId: string, sale: Sale): Promise<void> {
    const existing = await this.getSales(clientId);
    this.pjSales.set(clientId, [...existing, sale]);
  }

  // PJ - Sale Legs
  async getSaleLegs(clientId: string): Promise<SaleLeg[]> {
    return this.pjSaleLegs.get(clientId) || [];
  }

  async setSaleLegs(clientId: string, legs: SaleLeg[]): Promise<void> {
    this.pjSaleLegs.set(clientId, legs);
  }

  async updateSaleLeg(clientId: string, saleLegId: string, updates: Partial<SaleLeg>): Promise<void> {
    const legs = await this.getSaleLegs(clientId);
    const index = legs.findIndex(l => l.saleLegId === saleLegId);
    if (index !== -1) {
      legs[index] = { ...legs[index], ...updates };
      this.pjSaleLegs.set(clientId, legs);
    }
  }

  // PJ - Payment Methods
  async getPaymentMethods(clientId: string): Promise<PaymentMethod[]> {
    return this.pjPaymentMethods.get(clientId) || [];
  }

  async setPaymentMethods(clientId: string, methods: PaymentMethod[]): Promise<void> {
    this.pjPaymentMethods.set(clientId, methods);
  }

  // PJ - Ledger
  async getLedgerEntries(clientId: string): Promise<LedgerEntry[]> {
    return this.pjLedgerEntries.get(clientId) || [];
  }

  async setLedgerEntries(clientId: string, entries: LedgerEntry[]): Promise<void> {
    this.pjLedgerEntries.set(clientId, entries);
  }

  async addLedgerEntry(clientId: string, entry: LedgerEntry): Promise<void> {
    const existing = await this.getLedgerEntries(clientId);
    this.pjLedgerEntries.set(clientId, [...existing, entry]);
  }

  // PJ - Bank Transactions
  async getBankTransactions(clientId: string): Promise<BankTransaction[]> {
    return this.pjBankTransactions.get(clientId) || [];
  }

  async setBankTransactions(clientId: string, transactions: BankTransaction[]): Promise<void> {
    this.pjBankTransactions.set(clientId, transactions);
  }

  async addBankTransactions(clientId: string, transactions: BankTransaction[]): Promise<void> {
    const existing = await this.getBankTransactions(clientId);
    this.pjBankTransactions.set(clientId, [...existing, ...transactions]);
  }

  async updateBankTransaction(clientId: string, bankTxId: string, updates: Partial<BankTransaction>): Promise<void> {
    const transactions = await this.getBankTransactions(clientId);
    const index = transactions.findIndex(t => t.bankTxId === bankTxId);
    if (index !== -1) {
      transactions[index] = { ...transactions[index], ...updates };
      this.pjBankTransactions.set(clientId, transactions);
    }
  }

  // PJ - Categorization Rules
  async getCategorizationRules(clientId: string): Promise<CategorizationRule[]> {
    return this.pjCategorizationRules.get(clientId) || [];
  }

  async setCategorizationRules(clientId: string, rules: CategorizationRule[]): Promise<void> {
    this.pjCategorizationRules.set(clientId, rules);
  }

  async addCategorizationRule(clientId: string, rule: CategorizationRule): Promise<void> {
    const existing = await this.getCategorizationRules(clientId);
    this.pjCategorizationRules.set(clientId, [...existing, rule]);
  }

  async updateCategorizationRule(clientId: string, ruleId: string, updates: Partial<CategorizationRule>): Promise<void> {
    const rules = await this.getCategorizationRules(clientId);
    const index = rules.findIndex(r => r.ruleId === ruleId);
    if (index !== -1) {
      rules[index] = { ...rules[index], ...updates };
      this.pjCategorizationRules.set(clientId, rules);
    }
  }

  async recordAudit(entry: AuditLogEntry): Promise<void> {
    const existing = this.auditLogs.get(entry.organizationId) ?? [];
    this.auditLogs.set(entry.organizationId, [...existing, entry].slice(-500));
  }

  async getAuditLogs(organizationId: string, limit = 100): Promise<AuditLogEntry[]> {
    const entries = this.auditLogs.get(organizationId) ?? [];
    return entries.slice(Math.max(0, entries.length - limit)).reverse();
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

  async anonymizeUser(userId: string): Promise<User | undefined> {
    const existing = await this.getUserById(userId);
    if (!existing) {
      return undefined;
    }
    const anonymized: User = {
      ...existing,
      name: "Usuário Anonimizado",
      email: `${userId}@anon.finco`,
      passwordHash: existing.passwordHash,
      managerId: undefined,
      consultantId: undefined,
    };
    const setResult = await this.db.set(`user:${userId}`, anonymized);
    if (!setResult.ok) {
      throw new Error(`Database error anonymizing user: ${setResult.error?.message || JSON.stringify(setResult.error)}`);
    }
    return anonymized;
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

  async anonymizeClient(clientId: string): Promise<Client | undefined> {
    const existing = await this.getClient(clientId);
    if (!existing) {
      return undefined;
    }
    const anonymized: Client = {
      ...existing,
      name: "Cliente Anonimizado",
      email: `${clientId}@anon.finco`,
    };
    const setResult = await this.db.set(`client:${clientId}`, anonymized);
    if (!setResult.ok) {
      throw new Error(`Database error anonymizing client: ${setResult.error?.message || JSON.stringify(setResult.error)}`);
    }
    return anonymized;
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

  // PJ - Sales
  async getSales(clientId: string): Promise<Sale[]> {
    const result = await this.db.get(`pj_sales:${clientId}`);
    if (!result.ok && result.error?.statusCode !== 404) {
      throw new Error(`Database error getting PJ sales for ${clientId}: ${result.error?.message || JSON.stringify(result.error)}`);
    }
    return result.ok ? (result.value ?? []) : [];
  }

  async setSales(clientId: string, sales: Sale[]): Promise<void> {
    const result = await this.db.set(`pj_sales:${clientId}`, sales);
    if (!result.ok) {
      throw new Error(`Database error setting PJ sales for ${clientId}: ${result.error.message}`);
    }
  }

  async addSale(clientId: string, sale: Sale): Promise<void> {
    const existing = await this.getSales(clientId);
    await this.setSales(clientId, [...existing, sale]);
  }

  // PJ - Sale Legs
  async getSaleLegs(clientId: string): Promise<SaleLeg[]> {
    const result = await this.db.get(`pj_sale_legs:${clientId}`);
    if (!result.ok && result.error?.statusCode !== 404) {
      throw new Error(`Database error getting PJ sale legs for ${clientId}: ${result.error?.message || JSON.stringify(result.error)}`);
    }
    return result.ok ? (result.value ?? []) : [];
  }

  async setSaleLegs(clientId: string, legs: SaleLeg[]): Promise<void> {
    const result = await this.db.set(`pj_sale_legs:${clientId}`, legs);
    if (!result.ok) {
      throw new Error(`Database error setting PJ sale legs for ${clientId}: ${result.error.message}`);
    }
  }

  async updateSaleLeg(clientId: string, saleLegId: string, updates: Partial<SaleLeg>): Promise<void> {
    const legs = await this.getSaleLegs(clientId);
    const index = legs.findIndex(l => l.saleLegId === saleLegId);
    if (index !== -1) {
      legs[index] = { ...legs[index], ...updates };
      await this.setSaleLegs(clientId, legs);
    }
  }

  // PJ - Payment Methods
  async getPaymentMethods(clientId: string): Promise<PaymentMethod[]> {
    const result = await this.db.get(`pj_payment_methods:${clientId}`);
    if (!result.ok && result.error?.statusCode !== 404) {
      throw new Error(`Database error getting PJ payment methods for ${clientId}: ${result.error?.message || JSON.stringify(result.error)}`);
    }
    return result.ok ? (result.value ?? []) : [];
  }

  async setPaymentMethods(clientId: string, methods: PaymentMethod[]): Promise<void> {
    const result = await this.db.set(`pj_payment_methods:${clientId}`, methods);
    if (!result.ok) {
      throw new Error(`Database error setting PJ payment methods for ${clientId}: ${result.error.message}`);
    }
  }

  // PJ - Ledger
  async getLedgerEntries(clientId: string): Promise<LedgerEntry[]> {
    const result = await this.db.get(`pj_ledger:${clientId}`);
    if (!result.ok && result.error?.statusCode !== 404) {
      throw new Error(`Database error getting PJ ledger for ${clientId}: ${result.error?.message || JSON.stringify(result.error)}`);
    }
    return result.ok ? (result.value ?? []) : [];
  }

  async setLedgerEntries(clientId: string, entries: LedgerEntry[]): Promise<void> {
    const result = await this.db.set(`pj_ledger:${clientId}`, entries);
    if (!result.ok) {
      throw new Error(`Database error setting PJ ledger for ${clientId}: ${result.error.message}`);
    }
  }

  async addLedgerEntry(clientId: string, entry: LedgerEntry): Promise<void> {
    const existing = await this.getLedgerEntries(clientId);
    await this.setLedgerEntries(clientId, [...existing, entry]);
  }

  // PJ - Bank Transactions
  async getBankTransactions(clientId: string): Promise<BankTransaction[]> {
    const result = await this.db.get(`pj_bank_tx:${clientId}`);
    if (!result.ok && result.error?.statusCode !== 404) {
      throw new Error(`Database error getting PJ bank transactions for ${clientId}: ${result.error?.message || JSON.stringify(result.error)}`);
    }
    return result.ok ? (result.value ?? []) : [];
  }

  async setBankTransactions(clientId: string, transactions: BankTransaction[]): Promise<void> {
    const result = await this.db.set(`pj_bank_tx:${clientId}`, transactions);
    if (!result.ok) {
      throw new Error(`Database error setting PJ bank transactions for ${clientId}: ${result.error.message}`);
    }
  }

  async addBankTransactions(clientId: string, transactions: BankTransaction[]): Promise<void> {
    const existing = await this.getBankTransactions(clientId);
    await this.setBankTransactions(clientId, [...existing, ...transactions]);
  }

  async updateBankTransaction(clientId: string, bankTxId: string, updates: Partial<BankTransaction>): Promise<void> {
    const transactions = await this.getBankTransactions(clientId);
    const index = transactions.findIndex(t => t.bankTxId === bankTxId);
    if (index !== -1) {
      transactions[index] = { ...transactions[index], ...updates };
      await this.setBankTransactions(clientId, transactions);
    }
  }

  // PJ - Categorization Rules
  async getCategorizationRules(clientId: string): Promise<CategorizationRule[]> {
    const result = await this.db.get(`pj_categorization_rules:${clientId}`);
    if (!result.ok && result.error?.statusCode !== 404) {
      throw new Error(`Database error getting PJ categorization rules for ${clientId}: ${result.error?.message || JSON.stringify(result.error)}`);
    }
    return result.ok ? (result.value ?? []) : [];
  }

  async setCategorizationRules(clientId: string, rules: CategorizationRule[]): Promise<void> {
    const result = await this.db.set(`pj_categorization_rules:${clientId}`, rules);
    if (!result.ok) {
      throw new Error(`Database error setting PJ categorization rules for ${clientId}: ${result.error.message}`);
    }
  }

  async addCategorizationRule(clientId: string, rule: CategorizationRule): Promise<void> {
    const existing = await this.getCategorizationRules(clientId);
    await this.setCategorizationRules(clientId, [...existing, rule]);
  }

  async updateCategorizationRule(clientId: string, ruleId: string, updates: Partial<CategorizationRule>): Promise<void> {
    const rules = await this.getCategorizationRules(clientId);
    const index = rules.findIndex(r => r.ruleId === ruleId);
    if (index !== -1) {
      rules[index] = { ...rules[index], ...updates };
      await this.setCategorizationRules(clientId, rules);
    }
  }

  async recordAudit(entry: AuditLogEntry): Promise<void> {
    const key = `audit:${entry.organizationId}`;
    const existingResult = await this.db.get(key);
    if (!existingResult.ok && existingResult.error?.statusCode !== 404) {
      throw new Error(`Database error getting audit log for ${entry.organizationId}: ${existingResult.error?.message || JSON.stringify(existingResult.error)}`);
    }
    const events: AuditLogEntry[] = existingResult.ok ? (existingResult.value ?? []) : [];
    events.push(entry);
    const trimmed = events.slice(-500);
    const setResult = await this.db.set(key, trimmed);
    if (!setResult.ok) {
      throw new Error(`Database error writing audit log for ${entry.organizationId}: ${setResult.error?.message || JSON.stringify(setResult.error)}`);
    }
  }

  async getAuditLogs(organizationId: string, limit = 100): Promise<AuditLogEntry[]> {
    const key = `audit:${organizationId}`;
    const result = await this.db.get(key);
    if (!result.ok && result.error?.statusCode !== 404) {
      throw new Error(`Database error getting audit log for ${organizationId}: ${result.error?.message || JSON.stringify(result.error)}`);
    }
    const events: AuditLogEntry[] = result.ok ? (result.value ?? []) : [];
    const trimmed = events.slice(Math.max(0, events.length - limit));
    return trimmed.reverse();
  }
}

// Use ReplitDbStorage by default when configuration is present
const defaultStorage: IStorage = process.env.REPLIT_DB_URL
  ? new ReplitDbStorage()
  : new MemStorage();

export let storage: IStorage = defaultStorage;

export function setStorageProvider(next: IStorage) {
  storage = next;
}
