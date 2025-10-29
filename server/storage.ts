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
  BankAccount,
  BankSummarySnapshot,
  BankTransaction,
  CategorizationRule,
  PjCategory,
  PjClientCategory,
  AuditLogEntry,
} from "@shared/schema";
import Database from "@replit/database";

const PROCESSED_WEBHOOK_RETENTION_MS = 15 * 60 * 1000;

export interface PjClientCategoryRecord {
  id: string;
  orgId: string;
  clientId: string;
  baseCategoryId: string | null;
  name: string;
  description?: string | null;
  parentId: string | null;
  acceptsPostings: boolean;
  level: number;
  path: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface IStorage {
  // Health
  checkHealth(): Promise<void>;

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
  getOFXImport(clientId: string, bankAccountId: string, fileHash: string): Promise<OFXImport | null>;
  addOFXImport(ofxImport: OFXImport): Promise<void>;

  // Open Finance (Pluggy)
  getOFItems(clientId: string): Promise<OFItem[]>;
  setOFItems(clientId: string, items: OFItem[]): Promise<void>;
  addOFItem(clientId: string, item: OFItem): Promise<void>;
  
  getOFAccounts(clientId: string): Promise<OFAccount[]>;
  setOFAccounts(clientId: string, accounts: OFAccount[]): Promise<void>;

  // Bank accounts
  getBankAccounts(orgId: string, clientId?: string): Promise<BankAccount[]>;
  upsertBankAccount(account: BankAccount): Promise<BankAccount>;

  // Bank summaries
  getBankSummarySnapshots(
    orgId: string,
    clientId: string,
    bankAccountId?: string
  ): Promise<BankSummarySnapshot[]>;
  setBankSummarySnapshots(
    orgId: string,
    clientId: string,
    bankAccountId: string,
    snapshots: BankSummarySnapshot[]
  ): Promise<void>;
  upsertBankSummarySnapshot(snapshot: BankSummarySnapshot): Promise<void>;
  deleteBankSummarySnapshot(
    orgId: string,
    clientId: string,
    bankAccountId: string,
    window?: string
  ): Promise<void>;

  getOFSyncMeta(clientId: string): Promise<OFSyncMeta | null>;
  setOFSyncMeta(clientId: string, meta: OFSyncMeta): Promise<void>;

  // PJ - Categories
  getPjCategories(): Promise<PjCategory[]>;
  setPjCategories(categories: PjCategory[]): Promise<void>;
  getPjClientCategories(orgId: string, clientId: string): Promise<PjClientCategory[]>;
  bulkInsertPjClientCategories(
    orgId: string,
    clientId: string,
    categories: PjClientCategory[],
  ): Promise<void>;

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
  getBankTransactions(clientId: string, bankAccountId?: string): Promise<BankTransaction[]>;
  setBankTransactions(
    clientId: string,
    transactions: BankTransaction[],
    bankAccountId?: string
  ): Promise<void>;
  addBankTransactions(clientId: string, transactions: BankTransaction[]): Promise<void>;
  updateBankTransaction(clientId: string, bankTxId: string, updates: Partial<BankTransaction>): Promise<void>;

  // PJ - Categorization Rules
  getCategorizationRules(clientId: string): Promise<CategorizationRule[]>;
  setCategorizationRules(clientId: string, rules: CategorizationRule[]): Promise<void>;
  addCategorizationRule(clientId: string, rule: CategorizationRule): Promise<void>;
  updateCategorizationRule(clientId: string, ruleId: string, updates: Partial<CategorizationRule>): Promise<void>;

  // PJ - Client Categories
  getPjClientCategories(orgId: string, clientId: string): Promise<PjClientCategoryRecord[]>;
  setPjClientCategories(
    orgId: string,
    clientId: string,
    categories: PjClientCategoryRecord[],
  ): Promise<void>;

  // Audit trail
  recordAudit(entry: AuditLogEntry): Promise<void>;
  getAuditLogs(organizationId: string, limit?: number): Promise<AuditLogEntry[]>;

  // Webhooks deduplication
  registerProcessedWebhook(key: string, timestampIso: string): Promise<void>;
  hasProcessedWebhook(key: string): Promise<boolean>;
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
  private bankAccounts: Map<string, BankAccount>;
  private bankSummaries: Map<string, BankSummarySnapshot[]>;

  // PJ storage
  private pjCategories: Map<string, PjCategory>;
  private pjClientCategories: Map<string, Map<string, PjClientCategory>>;
  private pjSales: Map<string, Sale[]>;
  private pjSaleLegs: Map<string, SaleLeg[]>;
  private pjPaymentMethods: Map<string, PaymentMethod[]>;
  private pjLedgerEntries: Map<string, LedgerEntry[]>;
  private pjBankTransactions: Map<string, Map<string, BankTransaction[]> | BankTransaction[]>;
  private pjCategorizationRules: Map<string, CategorizationRule[]>;
  private pjClientCategories: Map<string, PjClientCategoryRecord[]>;
  private auditLogs: Map<string, AuditLogEntry[]>;
  private processedWebhooks: Map<string, string>;

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
    this.bankAccounts = new Map();
    this.bankSummaries = new Map();

    this.pjCategories = new Map();
    this.seedPjCategories();
    this.pjClientCategories = new Map();
    this.pjSales = new Map();
    this.pjSaleLegs = new Map();
    this.pjPaymentMethods = new Map();
    this.pjLedgerEntries = new Map();
    this.pjBankTransactions = new Map();
    this.pjCategorizationRules = new Map();
    this.pjClientCategories = new Map();
    this.auditLogs = new Map();
    this.processedWebhooks = new Map();
  }

  private seedPjCategories(): void {
    const now = new Date().toISOString();
    const seeds: PjCategory[] = [
      {
        id: "seed-pj-category-receita",
        code: "RECEITA",
        name: "Receitas",
        description: "Entradas operacionais de vendas e serviços.",
        parentId: null,
        isCore: true,
        acceptsPostings: false,
        level: 1,
        path: "RECEITA",
        sortOrder: 10,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "seed-pj-category-deducoes-receita",
        code: "DEDUCOES_RECEITA",
        name: "(-) Deduções da Receita",
        description: "Descontos, impostos e devoluções associados às receitas.",
        parentId: null,
        isCore: true,
        acceptsPostings: false,
        level: 1,
        path: "DEDUCOES_RECEITA",
        sortOrder: 20,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "seed-pj-category-gea",
        code: "GEA",
        name: "(-) Despesas Gerais e Administrativas",
        description: "Custos operacionais administrativos.",
        parentId: null,
        isCore: true,
        acceptsPostings: false,
        level: 1,
        path: "GEA",
        sortOrder: 30,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "seed-pj-category-comercial-mkt",
        code: "COMERCIAL_MKT",
        name: "(-) Despesas Comerciais e Marketing",
        description: "Gastos comerciais e de marketing.",
        parentId: null,
        isCore: true,
        acceptsPostings: false,
        level: 1,
        path: "COMERCIAL_MKT",
        sortOrder: 40,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "seed-pj-category-financeiras",
        code: "FINANCEIRAS",
        name: "(-/+) Despesas e Receitas Financeiras",
        description: "Receitas e despesas financeiras.",
        parentId: null,
        isCore: true,
        acceptsPostings: false,
        level: 1,
        path: "FINANCEIRAS",
        sortOrder: 50,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "seed-pj-category-outras",
        code: "OUTRAS",
        name: "(-/+) Outras Despesas e Receitas Não Operacionais",
        description: "Eventos não operacionais.",
        parentId: null,
        isCore: true,
        acceptsPostings: false,
        level: 1,
        path: "OUTRAS",
        sortOrder: 60,
        createdAt: now,
        updatedAt: now,
      },
    ];

    this.pjCategories.clear();
    for (const category of seeds) {
      this.pjCategories.set(category.id, category);
    }
  }

  private getClientCategoryBucket(orgId: string, clientId: string): Map<string, PjClientCategory> {
    const key = `${orgId}:${clientId}`;
    let bucket = this.pjClientCategories.get(key);
    if (!bucket) {
      bucket = new Map();
      this.pjClientCategories.set(key, bucket);
    }
    return bucket;
  }

  private sortPjCategories<T extends { sortOrder?: number; path: string }>(categories: T[]): T[] {
    return [...categories].sort((a, b) => {
      const sortDiff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      if (sortDiff !== 0) {
        return sortDiff;
      }
      return a.path.localeCompare(b.path);
    });
  }

  async checkHealth(): Promise<void> {
    // In-memory storage is always available when the process is alive.
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
  private getOfxImportKey(
    clientId: string,
    bankAccountId: string | undefined,
    fileHash: string
  ): string {
    const namespacedBankAccountId = bankAccountId ?? "legacy";
    return `ofxImport:${clientId}:${namespacedBankAccountId}:${fileHash}`;
  }

  async getOFXImport(
    clientId: string,
    bankAccountId: string,
    fileHash: string
  ): Promise<OFXImport | null> {
    const normalizedKey = this.getOfxImportKey(clientId, bankAccountId, fileHash);
    const existing = this.ofxImports.get(normalizedKey);
    if (existing) {
      return existing;
    }

    const legacyEntry = this.ofxImports.get(fileHash);
    if (
      legacyEntry &&
      (!legacyEntry.clientId || legacyEntry.clientId === clientId) &&
      (!legacyEntry.bankAccountId || legacyEntry.bankAccountId === bankAccountId)
    ) {
      const migrated: OFXImport = {
        ...legacyEntry,
        clientId: legacyEntry.clientId ?? clientId,
        bankAccountId: legacyEntry.bankAccountId ?? bankAccountId,
      };
      this.ofxImports.delete(fileHash);
      this.ofxImports.set(
        this.getOfxImportKey(migrated.clientId, migrated.bankAccountId, fileHash),
        migrated
      );
      return migrated;
    }

    return null;
  }

  async addOFXImport(ofxImport: OFXImport): Promise<void> {
    this.ofxImports.set(
      this.getOfxImportKey(ofxImport.clientId, ofxImport.bankAccountId, ofxImport.fileHash),
      ofxImport
    );
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

  private getBankAccountKey(orgId: string, fingerprint: string): string {
    return `${orgId}:${fingerprint}`;
  }

  async getBankAccounts(orgId: string, clientId?: string): Promise<BankAccount[]> {
    const accounts = Array.from(this.bankAccounts.values()).filter(account => {
      if (account.orgId !== orgId) {
        return false;
      }
      if (clientId && account.clientId !== clientId) {
        return false;
      }
      return true;
    });

    const deduped = new Map<string, BankAccount>();
    for (const account of accounts) {
      deduped.set(account.accountFingerprint, account);
    }

    return Array.from(deduped.values());
  }

  async upsertBankAccount(account: BankAccount): Promise<BankAccount> {
    const key = this.getBankAccountKey(account.orgId, account.accountFingerprint);
    const existing = this.bankAccounts.get(key);
    const now = new Date().toISOString();
    const merged: BankAccount = {
      ...existing,
      ...account,
      createdAt: existing?.createdAt ?? account.createdAt ?? now,
      updatedAt: account.updatedAt ?? now,
    } as BankAccount;

    this.bankAccounts.set(key, merged);
    return merged;
  }

  async getOFSyncMeta(clientId: string): Promise<OFSyncMeta | null> {
    return this.ofSyncMeta.get(clientId) || null;
  }

  async setOFSyncMeta(clientId: string, meta: OFSyncMeta): Promise<void> {
    this.ofSyncMeta.set(clientId, meta);
  }

  // PJ - Categories
  async getPjCategories(): Promise<PjCategory[]> {
    return this.sortPjCategories(Array.from(this.pjCategories.values()));
  }

  async setPjCategories(categories: PjCategory[]): Promise<void> {
    this.pjCategories.clear();
    for (const category of categories) {
      this.pjCategories.set(category.id, category);
    }
  }

  async getPjClientCategories(orgId: string, clientId: string): Promise<PjClientCategory[]> {
    const bucket = this.getClientCategoryBucket(orgId, clientId);
    return this.sortPjCategories(Array.from(bucket.values()));
  }

  async bulkInsertPjClientCategories(
    orgId: string,
    clientId: string,
    categories: PjClientCategory[],
  ): Promise<void> {
    if (categories.length === 0) {
      return;
    }

    const bucket = this.getClientCategoryBucket(orgId, clientId);
    for (const category of categories) {
      bucket.set(category.id, { ...category, orgId, clientId });
    }
  }

  private getBankSummaryKey(orgId: string, clientId: string, bankAccountId: string): string {
    return `${orgId}:${clientId}:${bankAccountId}`;
  }

  private getPjClientCategoryKey(orgId: string, clientId: string): string {
    return `pj_client_categories:${orgId}:${clientId}`;
  }

  async getBankSummarySnapshots(
    orgId: string,
    clientId: string,
    bankAccountId?: string
  ): Promise<BankSummarySnapshot[]> {
    if (bankAccountId) {
      return this.bankSummaries.get(this.getBankSummaryKey(orgId, clientId, bankAccountId)) ?? [];
    }

    const prefix = `${orgId}:${clientId}:`;
    const snapshots: BankSummarySnapshot[] = [];
    for (const [key, value] of Array.from(this.bankSummaries.entries())) {
      if (key.startsWith(prefix)) {
        snapshots.push(...value);
      }
    }
    return snapshots;
  }

  async setBankSummarySnapshots(
    orgId: string,
    clientId: string,
    bankAccountId: string,
    snapshots: BankSummarySnapshot[]
  ): Promise<void> {
    const key = this.getBankSummaryKey(orgId, clientId, bankAccountId);
    if (snapshots.length === 0) {
      this.bankSummaries.delete(key);
      return;
    }

    const normalized = snapshots.map(snapshot => ({
      ...snapshot,
      organizationId: snapshot.organizationId ?? orgId,
      clientId: snapshot.clientId ?? clientId,
      bankAccountId: snapshot.bankAccountId ?? bankAccountId,
    }));

    this.bankSummaries.set(key, normalized);
  }

  async upsertBankSummarySnapshot(snapshot: BankSummarySnapshot): Promise<void> {
    const { organizationId, clientId, bankAccountId, window } = snapshot;
    if (!window) {
      throw new Error("Bank summary snapshot requires a window identifier");
    }

    const key = this.getBankSummaryKey(organizationId, clientId, bankAccountId);
    const current = this.bankSummaries.get(key) ?? [];
    const index = current.findIndex(existing => existing.window === window);
    if (index === -1) {
      current.push(snapshot);
    } else {
      current[index] = snapshot;
    }
    this.bankSummaries.set(key, current);
  }

  async deleteBankSummarySnapshot(
    orgId: string,
    clientId: string,
    bankAccountId: string,
    window?: string
  ): Promise<void> {
    const key = this.getBankSummaryKey(orgId, clientId, bankAccountId);
    if (!this.bankSummaries.has(key)) {
      return;
    }

    if (!window) {
      this.bankSummaries.delete(key);
      return;
    }

    const remaining = (this.bankSummaries.get(key) ?? []).filter(snapshot => snapshot.window !== window);
    if (remaining.length === 0) {
      this.bankSummaries.delete(key);
    } else {
      this.bankSummaries.set(key, remaining);
    }
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
  private ensureBankTransactionBucket(clientId: string): Map<string, BankTransaction[]> {
    const existing = this.pjBankTransactions.get(clientId);
    if (existing instanceof Map) {
      return existing;
    }

    if (Array.isArray(existing)) {
      const legacyList = existing as BankTransaction[];
      const bucket = new Map<string, BankTransaction[]>();
      for (const tx of legacyList) {
        const bankAccountId = tx.bankAccountId ?? tx.accountId ?? "unknown";
        const list = bucket.get(bankAccountId) ?? [];
        list.push({ ...tx, bankAccountId });
        bucket.set(bankAccountId, list);
      }
      this.pjBankTransactions.set(clientId, bucket);
      return bucket;
    }

    const bucket = new Map<string, BankTransaction[]>();
    this.pjBankTransactions.set(clientId, bucket);
    return bucket;
  }

  async getBankTransactions(clientId: string, bankAccountId?: string): Promise<BankTransaction[]> {
    const bucket = this.ensureBankTransactionBucket(clientId);
    if (bankAccountId) {
      return bucket.get(bankAccountId) ? [...bucket.get(bankAccountId)!] : [];
    }

    return Array.from(bucket.values()).flat();
  }

  async setBankTransactions(
    clientId: string,
    transactions: BankTransaction[],
    bankAccountId?: string
  ): Promise<void> {
    const bucket = this.ensureBankTransactionBucket(clientId);

    if (bankAccountId) {
      bucket.set(
        bankAccountId,
        transactions.map(tx => ({ ...tx, bankAccountId: tx.bankAccountId ?? bankAccountId }))
      );
      return;
    }

    bucket.clear();
    for (const tx of transactions) {
      const txAccountId = tx.bankAccountId;
      if (!txAccountId) {
        throw new Error("Bank transaction missing bankAccountId in setBankTransactions");
      }
      const list = bucket.get(txAccountId) ?? [];
      list.push(tx);
      bucket.set(txAccountId, list);
    }
  }

  async addBankTransactions(clientId: string, transactions: BankTransaction[]): Promise<void> {
    const bucket = this.ensureBankTransactionBucket(clientId);
    for (const tx of transactions) {
      if (!tx.bankAccountId) {
        throw new Error("Bank transaction missing bankAccountId in addBankTransactions");
      }
      const list = bucket.get(tx.bankAccountId) ?? [];
      list.push(tx);
      bucket.set(tx.bankAccountId, list);
    }
  }

  async updateBankTransaction(clientId: string, bankTxId: string, updates: Partial<BankTransaction>): Promise<void> {
    const bucket = this.ensureBankTransactionBucket(clientId);
    for (const [accountId, list] of Array.from(bucket.entries())) {
      const index = list.findIndex((t: BankTransaction) => t.bankTxId === bankTxId);
      if (index === -1) {
        continue;
      }
      const updated = { ...list[index], ...updates };
      updated.bankAccountId = updates.bankAccountId ?? list[index].bankAccountId ?? accountId;
      list[index] = updated;
      bucket.set(accountId, list);
      return;
    }

    throw new Error(`Bank transaction ${bankTxId} not found for client ${clientId}`);
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

  async getPjClientCategories(orgId: string, clientId: string): Promise<PjClientCategoryRecord[]> {
    const key = this.getPjClientCategoryKey(orgId, clientId);
    const categories = this.pjClientCategories.get(key);
    return categories ? categories.map(category => ({ ...category })) : [];
  }

  async setPjClientCategories(
    orgId: string,
    clientId: string,
    categories: PjClientCategoryRecord[],
  ): Promise<void> {
    const key = this.getPjClientCategoryKey(orgId, clientId);
    this.pjClientCategories.set(
      key,
      categories.map(category => ({ ...category })),
    );
  }

  async recordAudit(entry: AuditLogEntry): Promise<void> {
    const existing = this.auditLogs.get(entry.organizationId) ?? [];
    this.auditLogs.set(entry.organizationId, [...existing, entry].slice(-500));
  }

  async getAuditLogs(organizationId: string, limit = 100): Promise<AuditLogEntry[]> {
    const entries = this.auditLogs.get(organizationId) ?? [];
    return entries.slice(Math.max(0, entries.length - limit)).reverse();
  }

  private pruneProcessedWebhooks(now = Date.now()): void {
    for (const [key, iso] of Array.from(this.processedWebhooks.entries())) {
      const timestamp = Date.parse(iso);
      if (Number.isNaN(timestamp) || now - timestamp > PROCESSED_WEBHOOK_RETENTION_MS) {
        this.processedWebhooks.delete(key);
      }
    }
  }

  async registerProcessedWebhook(key: string, timestampIso: string): Promise<void> {
    this.pruneProcessedWebhooks();
    this.processedWebhooks.set(key, timestampIso);
  }

  async hasProcessedWebhook(key: string): Promise<boolean> {
    const now = Date.now();
    this.pruneProcessedWebhooks(now);
    const iso = this.processedWebhooks.get(key);
    if (!iso) {
      return false;
    }

    const timestamp = Date.parse(iso);
    if (Number.isNaN(timestamp)) {
      this.processedWebhooks.delete(key);
      return false;
    }

    if (now - timestamp > PROCESSED_WEBHOOK_RETENTION_MS) {
      this.processedWebhooks.delete(key);
      return false;
    }

    return true;
  }
}

export class ReplitDbStorage implements IStorage {
  private db: Database;
  private migrationsReady: Promise<void>;

  constructor() {
    this.db = new Database();
    this.migrationsReady = this.normalizeLegacyOFXImports();
  }

  async checkHealth(): Promise<void> {
    await this.migrationsReady;

    const probeKey = `healthcheck:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const setResult = await this.db.set(probeKey, "ok");
    if (!setResult.ok) {
      throw new Error(
        `Database error setting healthcheck key: ${setResult.error?.message || JSON.stringify(setResult.error)}`
      );
    }

    const deleteResult = await this.db.delete(probeKey);
    if (!deleteResult.ok) {
      throw new Error(
        `Database error deleting healthcheck key: ${deleteResult.error?.message || JSON.stringify(deleteResult.error)}`
      );
    }
  }

  private getOfxImportKey(
    clientId: string,
    bankAccountId: string | undefined,
    fileHash: string
  ): string {
    const namespacedBankAccountId = bankAccountId ?? "legacy";
    return `ofxImport:${clientId}:${namespacedBankAccountId}:${fileHash}`;
  }

  private getLegacyClientOfxImportKey(clientId: string, fileHash: string): string {
    return `ofxImport:${clientId}:${fileHash}`;
  }

  private getLegacyOfxImportKey(fileHash: string): string {
    return `ofxImport:${fileHash}`;
  }

  private getPjCategoriesKey(): string {
    return "pj_categories";
  }

  private getPjClientCategoriesKey(orgId: string, clientId: string): string {
    return `pj_client_categories:${orgId}:${clientId}`;
  }

  private sortPjCategories<T extends { sortOrder?: number; path: string }>(categories: T[]): T[] {
    return [...categories].sort((a, b) => {
      const sortDiff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      if (sortDiff !== 0) {
        return sortDiff;
      }
      return a.path.localeCompare(b.path);
    });
  }

  private getBankAccountKey(orgId: string, fingerprint: string): string {
    return `bank_account:${orgId}:${fingerprint}`;
  }

  private getBankAccountIndexKey(orgId: string): string {
    return `bank_account_index:${orgId}`;
  }

  private getBankTransactionsKey(clientId: string, bankAccountId: string): string {
    return `pj_bank_tx:${clientId}:${bankAccountId}`;
  }

  private getBankTransactionIndexKey(clientId: string): string {
    return `pj_bank_tx_index:${clientId}`;
  }

  private getPjClientCategoryKey(orgId: string, clientId: string): string {
    return `pj_client_categories:${orgId}:${clientId}`;
  }

  // Bank summary snapshots are stored under pj_bank_summary:{orgId}:{clientId}:{bankAccountId}
  private getBankSummaryKey(orgId: string, clientId: string, bankAccountId: string): string {
    return `pj_bank_summary:${orgId}:${clientId}:${bankAccountId}`;
  }

  private getBankSummaryIndexKey(orgId: string, clientId: string): string {
    return `pj_bank_summary_index:${orgId}:${clientId}`;
  }

  private getLegacyBankTransactionsKey(clientId: string): string {
    return `pj_bank_tx:${clientId}`;
  }

  private async loadBankTransactionIndex(clientId: string): Promise<string[]> {
    const result = await this.db.get(this.getBankTransactionIndexKey(clientId));
    if (!result.ok) {
      if (result.error?.statusCode !== 404) {
        throw new Error(`Database error getting bank transaction index for ${clientId}: ${result.error?.message || JSON.stringify(result.error)}`);
      }
      return [];
    }
    return Array.isArray(result.value) ? result.value : [];
  }

  private async saveBankTransactionIndex(clientId: string, accountIds: string[]): Promise<void> {
    const unique = Array.from(new Set(accountIds));
    const result = await this.db.set(this.getBankTransactionIndexKey(clientId), unique);
    if (!result.ok) {
      throw new Error(`Database error setting bank transaction index for ${clientId}: ${result.error?.message || JSON.stringify(result.error)}`);
    }
  }

  private async loadBankSummaryIndex(orgId: string, clientId: string): Promise<string[]> {
    const result = await this.db.get(this.getBankSummaryIndexKey(orgId, clientId));
    if (!result.ok) {
      if (result.error?.statusCode !== 404) {
        throw new Error(
          `Database error getting bank summary index for ${orgId}:${clientId}: ${result.error?.message || JSON.stringify(result.error)}`
        );
      }
      return [];
    }
    return Array.isArray(result.value) ? result.value : [];
  }

  private async saveBankSummaryIndex(orgId: string, clientId: string, bankAccountIds: string[]): Promise<void> {
    const unique = Array.from(new Set(bankAccountIds));
    const result = await this.db.set(this.getBankSummaryIndexKey(orgId, clientId), unique);
    if (!result.ok) {
      throw new Error(
        `Database error setting bank summary index for ${orgId}:${clientId}: ${result.error?.message || JSON.stringify(result.error)}`
      );
    }
  }

  private async migrateLegacyBankTransactions(clientId: string, legacy: BankTransaction[]): Promise<void> {
    const grouped = new Map<string, BankTransaction[]>();
    for (const tx of legacy) {
      const accountId = tx.bankAccountId || tx.accountId || "unknown";
      const list = grouped.get(accountId) ?? [];
      list.push({ ...tx, bankAccountId: accountId });
      grouped.set(accountId, list);
    }

    const accountIds: string[] = [];
    for (const [accountId, transactions] of Array.from(grouped.entries())) {
      const key = this.getBankTransactionsKey(clientId, accountId);
      const setResult = await this.db.set(key, transactions);
      if (!setResult.ok) {
        throw new Error(`Database error migrating bank transactions for ${clientId}:${accountId}: ${setResult.error?.message || JSON.stringify(setResult.error)}`);
      }
      accountIds.push(accountId);
    }

    await this.saveBankTransactionIndex(clientId, accountIds);

    const legacyKey = this.getLegacyBankTransactionsKey(clientId);
    const deleteResult = await this.db.delete(legacyKey);
    if (!deleteResult.ok && deleteResult.error?.statusCode !== 404) {
      throw new Error(`Database error deleting legacy bank transactions for ${clientId}: ${deleteResult.error?.message || JSON.stringify(deleteResult.error)}`);
    }
  }

  private async normalizeLegacyOFXImports(): Promise<void> {
    try {
      const listResult = await this.db.list("ofxImport:");
      if (!listResult.ok) {
        throw new Error(listResult.error?.message || "Unknown error listing OFX imports");
      }

      const keys = listResult.value ?? [];
      for (const key of keys) {
        const parts = key.split(":");
        if (parts.length >= 4) {
          continue; // already normalized
        }

        const legacyResult = await this.db.get(key);
        if (!legacyResult.ok) {
          if (legacyResult.error?.statusCode !== 404) {
            throw new Error(`Error loading legacy OFX import ${key}: ${legacyResult.error?.message || JSON.stringify(legacyResult.error)}`);
          }
          continue;
        }

        const legacyImport = legacyResult.value as OFXImport | null;
        if (!legacyImport) {
          await this.db.delete(key);
          continue;
        }

        const clientId = legacyImport.clientId;
        const fileHash = legacyImport.fileHash;
        const bankAccountId =
          legacyImport.bankAccountId ||
          legacyImport.reconciliation?.accounts?.[0]?.accountId ||
          "unknown";

        if (!clientId || !fileHash) {
          await this.db.delete(key);
          continue;
        }

        const normalizedImport: OFXImport = {
          ...legacyImport,
          clientId,
          bankAccountId,
        };

        const normalizedKey = this.getOfxImportKey(clientId, bankAccountId, fileHash);
        const setResult = await this.db.set(normalizedKey, normalizedImport);
        if (!setResult.ok) {
          throw new Error(`Error migrating OFX import ${key}: ${setResult.error?.message || JSON.stringify(setResult.error)}`);
        }

        const deleteResult = await this.db.delete(key);
        if (!deleteResult.ok) {
          throw new Error(`Error deleting legacy OFX import ${key}: ${deleteResult.error?.message || JSON.stringify(deleteResult.error)}`);
        }
      }
    } catch (error) {
      console.error("Failed to normalize legacy OFX imports", error);
    }
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
  async getOFXImport(clientId: string, bankAccountId: string, fileHash: string): Promise<OFXImport | null> {
    await this.migrationsReady;

    const key = this.getOfxImportKey(clientId, bankAccountId, fileHash);
    const result = await this.db.get(key);
    // 404 means key doesn't exist (file not imported before for this client)
    if (!result.ok && result.error?.statusCode !== 404) {
      throw new Error(`Database error getting OFX import ${clientId}:${fileHash}: ${result.error?.message || JSON.stringify(result.error)}`);
    }

    if (result.ok) {
      return result.value ?? null;
    }

    const clientLegacyKey = this.getLegacyClientOfxImportKey(clientId, fileHash);
    const clientLegacyResult = await this.db.get(clientLegacyKey);
    if (clientLegacyResult.ok) {
      const legacyImport = clientLegacyResult.value as OFXImport | null;
      if (legacyImport) {
        const normalized: OFXImport = {
          ...legacyImport,
          bankAccountId: legacyImport.bankAccountId || bankAccountId,
        };
        await this.addOFXImport(normalized);
        await this.db.delete(clientLegacyKey);
        return normalized;
      }
      await this.db.delete(clientLegacyKey);
      return null;
    }
    if (clientLegacyResult.error && clientLegacyResult.error.statusCode !== 404) {
      throw new Error(`Database error getting legacy client OFX import ${clientId}:${fileHash}: ${clientLegacyResult.error?.message || JSON.stringify(clientLegacyResult.error)}`);
    }

    const legacyKey = this.getLegacyOfxImportKey(fileHash);
    const legacyResult = await this.db.get(legacyKey);
    if (!legacyResult.ok) {
      if (legacyResult.error?.statusCode !== 404) {
        throw new Error(`Database error getting legacy OFX import ${fileHash}: ${legacyResult.error?.message || JSON.stringify(legacyResult.error)}`);
      }
      return null;
    }

    const legacyImport = legacyResult.value as OFXImport | null;
    if (!legacyImport || legacyImport.clientId !== clientId) {
      return null;
    }

    const normalized: OFXImport = {
      ...legacyImport,
      bankAccountId: legacyImport.bankAccountId || bankAccountId,
    };

    await this.addOFXImport(normalized);
    await this.db.delete(legacyKey);

    return normalized;
  }

  async addOFXImport(ofxImport: OFXImport): Promise<void> {
    await this.migrationsReady;

    const result = await this.db.set(
      this.getOfxImportKey(ofxImport.clientId, ofxImport.bankAccountId, ofxImport.fileHash),
      ofxImport
    );
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

  async getBankAccounts(orgId: string, clientId?: string): Promise<BankAccount[]> {
    await this.migrationsReady;

    const indexKey = this.getBankAccountIndexKey(orgId);
    const indexResult = await this.db.get(indexKey);
    if (!indexResult.ok && indexResult.error?.statusCode !== 404) {
      throw new Error(`Database error getting bank account index for ${orgId}: ${indexResult.error?.message || JSON.stringify(indexResult.error)}`);
    }

    const fingerprints: string[] = indexResult.ok ? (indexResult.value ?? []) : [];
    const deduped = new Map<string, BankAccount>();

    for (const fingerprint of fingerprints) {
      const key = this.getBankAccountKey(orgId, fingerprint);
      const accountResult = await this.db.get(key);
      if (!accountResult.ok && accountResult.error?.statusCode !== 404) {
        throw new Error(`Database error getting bank account ${fingerprint} for ${orgId}: ${accountResult.error?.message || JSON.stringify(accountResult.error)}`);
      }

      const account = accountResult.ok ? (accountResult.value as BankAccount | null) : null;
      if (!account) {
        continue;
      }
      if (account.orgId !== orgId) {
        continue;
      }
      if (clientId && account.clientId !== clientId) {
        continue;
      }

      deduped.set(account.accountFingerprint, account);
    }

    return Array.from(deduped.values());
  }

  async upsertBankAccount(account: BankAccount): Promise<BankAccount> {
    await this.migrationsReady;

    const key = this.getBankAccountKey(account.orgId, account.accountFingerprint);
    const existingResult = await this.db.get(key);
    if (!existingResult.ok && existingResult.error?.statusCode !== 404) {
      throw new Error(`Database error loading bank account ${account.accountFingerprint} for ${account.orgId}: ${existingResult.error?.message || JSON.stringify(existingResult.error)}`);
    }

    const existing = existingResult.ok ? (existingResult.value as BankAccount | null) : null;
    const now = new Date().toISOString();
    const merged: BankAccount = {
      ...(existing ?? {}),
      ...account,
      createdAt: existing?.createdAt ?? account.createdAt ?? now,
      updatedAt: account.updatedAt ?? now,
    };

    const setResult = await this.db.set(key, merged);
    if (!setResult.ok) {
      throw new Error(`Database error upserting bank account ${account.accountFingerprint} for ${account.orgId}: ${setResult.error?.message || JSON.stringify(setResult.error)}`);
    }

    const indexKey = this.getBankAccountIndexKey(account.orgId);
    const indexResult = await this.db.get(indexKey);
    if (!indexResult.ok && indexResult.error?.statusCode !== 404) {
      throw new Error(`Database error getting bank account index for ${account.orgId}: ${indexResult.error?.message || JSON.stringify(indexResult.error)}`);
    }

    const fingerprints: string[] = indexResult.ok ? (indexResult.value ?? []) : [];
    if (!fingerprints.includes(account.accountFingerprint)) {
      fingerprints.push(account.accountFingerprint);
      const updateIndexResult = await this.db.set(indexKey, fingerprints);
      if (!updateIndexResult.ok) {
        throw new Error(`Database error updating bank account index for ${account.orgId}: ${updateIndexResult.error?.message || JSON.stringify(updateIndexResult.error)}`);
      }
    }

    return merged;
  }

  async getBankSummarySnapshots(
    orgId: string,
    clientId: string,
    bankAccountId?: string
  ): Promise<BankSummarySnapshot[]> {
    if (bankAccountId) {
      const key = this.getBankSummaryKey(orgId, clientId, bankAccountId);
      const result = await this.db.get(key);
      if (!result.ok) {
        if (result.error?.statusCode === 404) {
          return [];
        }
        throw new Error(
          `Database error getting bank summary snapshots for ${orgId}:${clientId}:${bankAccountId}: ${result.error?.message || JSON.stringify(result.error)}`
        );
      }
      return (result.value as BankSummarySnapshot[] | null) ?? [];
    }

    const index = await this.loadBankSummaryIndex(orgId, clientId);
    if (index.length === 0) {
      return [];
    }

    const snapshots: BankSummarySnapshot[] = [];
    for (const accountId of index) {
      const key = this.getBankSummaryKey(orgId, clientId, accountId);
      const result = await this.db.get(key);
      if (!result.ok) {
        if (result.error?.statusCode === 404) {
          continue;
        }
        throw new Error(
          `Database error getting bank summary snapshots for ${orgId}:${clientId}:${accountId}: ${result.error?.message || JSON.stringify(result.error)}`
        );
      }
      const entries = (result.value as BankSummarySnapshot[] | null) ?? [];
      snapshots.push(...entries);
    }
    return snapshots;
  }

  async setBankSummarySnapshots(
    orgId: string,
    clientId: string,
    bankAccountId: string,
    snapshots: BankSummarySnapshot[]
  ): Promise<void> {
    const key = this.getBankSummaryKey(orgId, clientId, bankAccountId);

    if (snapshots.length === 0) {
      const deleteResult = await this.db.delete(key);
      if (!deleteResult.ok && deleteResult.error?.statusCode !== 404) {
        throw new Error(
          `Database error deleting bank summary snapshots for ${orgId}:${clientId}:${bankAccountId}: ${deleteResult.error?.message || JSON.stringify(deleteResult.error)}`
        );
      }

      const index = await this.loadBankSummaryIndex(orgId, clientId);
      const filtered = index.filter(id => id !== bankAccountId);
      await this.saveBankSummaryIndex(orgId, clientId, filtered);
      return;
    }

    const normalized = snapshots.map(snapshot => ({
      ...snapshot,
      organizationId: snapshot.organizationId ?? orgId,
      clientId: snapshot.clientId ?? clientId,
      bankAccountId: snapshot.bankAccountId ?? bankAccountId,
    }));

    const setResult = await this.db.set(key, normalized);
    if (!setResult.ok) {
      throw new Error(
        `Database error setting bank summary snapshots for ${orgId}:${clientId}:${bankAccountId}: ${setResult.error?.message || JSON.stringify(setResult.error)}`
      );
    }

    const index = await this.loadBankSummaryIndex(orgId, clientId);
    if (!index.includes(bankAccountId)) {
      index.push(bankAccountId);
      await this.saveBankSummaryIndex(orgId, clientId, index);
    }
  }

  async upsertBankSummarySnapshot(snapshot: BankSummarySnapshot): Promise<void> {
    const { organizationId, clientId, bankAccountId, window } = snapshot;
    if (!window) {
      throw new Error("Bank summary snapshot requires a window identifier");
    }

    const key = this.getBankSummaryKey(organizationId, clientId, bankAccountId);
    const existingResult = await this.db.get(key);
    if (!existingResult.ok && existingResult.error?.statusCode !== 404) {
      throw new Error(
        `Database error getting bank summary snapshots for ${organizationId}:${clientId}:${bankAccountId}: ${existingResult.error?.message || JSON.stringify(existingResult.error)}`
      );
    }

    const snapshots = existingResult.ok
      ? ((existingResult.value as BankSummarySnapshot[] | null) ?? [])
      : [];

    const index = snapshots.findIndex(entry => entry.window === window);
    if (index === -1) {
      snapshots.push(snapshot);
    } else {
      snapshots[index] = snapshot;
    }

    const setResult = await this.db.set(key, snapshots);
    if (!setResult.ok) {
      throw new Error(
        `Database error setting bank summary snapshots for ${organizationId}:${clientId}:${bankAccountId}: ${setResult.error?.message || JSON.stringify(setResult.error)}`
      );
    }

    const indexList = await this.loadBankSummaryIndex(organizationId, clientId);
    if (!indexList.includes(bankAccountId)) {
      indexList.push(bankAccountId);
      await this.saveBankSummaryIndex(organizationId, clientId, indexList);
    }
  }

  async deleteBankSummarySnapshot(
    orgId: string,
    clientId: string,
    bankAccountId: string,
    window?: string
  ): Promise<void> {
    const key = this.getBankSummaryKey(orgId, clientId, bankAccountId);
    const existingResult = await this.db.get(key);
    if (!existingResult.ok) {
      if (existingResult.error?.statusCode === 404) {
        return;
      }
      throw new Error(
        `Database error getting bank summary snapshots for ${orgId}:${clientId}:${bankAccountId}: ${existingResult.error?.message || JSON.stringify(existingResult.error)}`
      );
    }

    if (!window) {
      const deleteResult = await this.db.delete(key);
      if (!deleteResult.ok) {
        throw new Error(
          `Database error deleting bank summary snapshots for ${orgId}:${clientId}:${bankAccountId}: ${deleteResult.error?.message || JSON.stringify(deleteResult.error)}`
        );
      }

      const index = await this.loadBankSummaryIndex(orgId, clientId);
      const filtered = index.filter(id => id !== bankAccountId);
      await this.saveBankSummaryIndex(orgId, clientId, filtered);
      return;
    }

    const entries = (existingResult.value as BankSummarySnapshot[] | null) ?? [];
    const filteredEntries = entries.filter(snapshot => snapshot.window !== window);

    if (filteredEntries.length === 0) {
      const deleteResult = await this.db.delete(key);
      if (!deleteResult.ok) {
        throw new Error(
          `Database error deleting bank summary snapshots for ${orgId}:${clientId}:${bankAccountId}: ${deleteResult.error?.message || JSON.stringify(deleteResult.error)}`
        );
      }

      const index = await this.loadBankSummaryIndex(orgId, clientId);
      const filtered = index.filter(id => id !== bankAccountId);
      await this.saveBankSummaryIndex(orgId, clientId, filtered);
      return;
    }

    const setResult = await this.db.set(key, filteredEntries);
    if (!setResult.ok) {
      throw new Error(
        `Database error setting bank summary snapshots for ${orgId}:${clientId}:${bankAccountId}: ${setResult.error?.message || JSON.stringify(setResult.error)}`
      );
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

  // PJ - Categories
  async getPjCategories(): Promise<PjCategory[]> {
    const result = await this.db.get(this.getPjCategoriesKey());
    if (!result.ok && result.error?.statusCode !== 404) {
      throw new Error(
        `Database error getting PJ categories: ${result.error?.message || JSON.stringify(result.error)}`,
      );
    }

    const raw = result.ok ? result.value : null;
    const categories = Array.isArray(raw) ? (raw as PjCategory[]) : [];
    return this.sortPjCategories(categories);
  }

  async setPjCategories(categories: PjCategory[]): Promise<void> {
    const result = await this.db.set(this.getPjCategoriesKey(), categories);
    if (!result.ok) {
      throw new Error(
        `Database error setting PJ categories: ${result.error?.message || JSON.stringify(result.error)}`,
      );
    }
  }

  async getPjClientCategories(orgId: string, clientId: string): Promise<PjClientCategory[]> {
    const key = this.getPjClientCategoriesKey(orgId, clientId);
    const result = await this.db.get(key);
    if (!result.ok && result.error?.statusCode !== 404) {
      throw new Error(
        `Database error getting PJ client categories for ${orgId}:${clientId}: ${result.error?.message || JSON.stringify(result.error)}`,
      );
    }

    const raw = result.ok ? result.value : null;
    const categories = Array.isArray(raw) ? (raw as PjClientCategory[]) : [];
    return this.sortPjCategories(categories);
  }

  async bulkInsertPjClientCategories(
    orgId: string,
    clientId: string,
    categories: PjClientCategory[],
  ): Promise<void> {
    if (categories.length === 0) {
      return;
    }

    const existing = await this.getPjClientCategories(orgId, clientId);
    const merged = new Map(existing.map(category => [category.id, category] as const));
    for (const category of categories) {
      merged.set(category.id, { ...category, orgId, clientId });
    }

    const key = this.getPjClientCategoriesKey(orgId, clientId);
    const result = await this.db.set(key, Array.from(merged.values()));
    if (!result.ok) {
      throw new Error(
        `Database error inserting PJ client categories for ${orgId}:${clientId}: ${result.error?.message || JSON.stringify(result.error)}`,
      );
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
  async getBankTransactions(clientId: string, bankAccountId?: string): Promise<BankTransaction[]> {
    let index = await this.loadBankTransactionIndex(clientId);

    if (bankAccountId) {
      if (!index.includes(bankAccountId)) {
        const legacyResult = await this.db.get(this.getLegacyBankTransactionsKey(clientId));
        if (legacyResult.ok) {
          await this.migrateLegacyBankTransactions(clientId, legacyResult.value ?? []);
          index = await this.loadBankTransactionIndex(clientId);
        } else if (legacyResult.error && legacyResult.error.statusCode !== 404) {
          throw new Error(`Database error getting legacy bank transactions for ${clientId}: ${legacyResult.error?.message || JSON.stringify(legacyResult.error)}`);
        }
      }

      const key = this.getBankTransactionsKey(clientId, bankAccountId);
      const result = await this.db.get(key);
      if (!result.ok) {
        if (result.error?.statusCode === 404) {
          return [];
        }
        throw new Error(`Database error getting PJ bank transactions for ${clientId}:${bankAccountId}: ${result.error?.message || JSON.stringify(result.error)}`);
      }
      return result.value ?? [];
    }

    if (index.length === 0) {
      const legacyResult = await this.db.get(this.getLegacyBankTransactionsKey(clientId));
      if (legacyResult.ok) {
        await this.migrateLegacyBankTransactions(clientId, legacyResult.value ?? []);
        index = await this.loadBankTransactionIndex(clientId);
      } else if (legacyResult.error && legacyResult.error.statusCode !== 404) {
        throw new Error(`Database error getting legacy bank transactions for ${clientId}: ${legacyResult.error?.message || JSON.stringify(legacyResult.error)}`);
      }
    }

    if (index.length === 0) {
      return [];
    }

    const transactions: BankTransaction[] = [];
    for (const accountId of index) {
      const key = this.getBankTransactionsKey(clientId, accountId);
      const result = await this.db.get(key);
      if (!result.ok) {
        if (result.error?.statusCode === 404) {
          continue;
        }
        throw new Error(`Database error getting PJ bank transactions for ${clientId}:${accountId}: ${result.error?.message || JSON.stringify(result.error)}`);
      }
      transactions.push(...((result.value as BankTransaction[] | null) ?? []));
    }
    return transactions;
  }

  async setBankTransactions(
    clientId: string,
    transactions: BankTransaction[],
    bankAccountId?: string
  ): Promise<void> {
    if (bankAccountId) {
      const normalized = transactions.map(tx => ({ ...tx, bankAccountId: tx.bankAccountId ?? bankAccountId }));
      if (normalized.length === 0) {
        await this.db.delete(this.getBankTransactionsKey(clientId, bankAccountId));
        const index = await this.loadBankTransactionIndex(clientId);
        const filtered = index.filter(id => id !== bankAccountId);
        await this.saveBankTransactionIndex(clientId, filtered);
        return;
      }

      const result = await this.db.set(this.getBankTransactionsKey(clientId, bankAccountId), normalized);
      if (!result.ok) {
        throw new Error(`Database error setting PJ bank transactions for ${clientId}:${bankAccountId}: ${result.error?.message || JSON.stringify(result.error)}`);
      }

      const index = await this.loadBankTransactionIndex(clientId);
      if (!index.includes(bankAccountId)) {
        index.push(bankAccountId);
        await this.saveBankTransactionIndex(clientId, index);
      }
      return;
    }

    const grouped = new Map<string, BankTransaction[]>();
    for (const tx of transactions) {
      if (!tx.bankAccountId) {
        throw new Error("Bank transaction missing bankAccountId in setBankTransactions");
      }
      const list = grouped.get(tx.bankAccountId) ?? [];
      list.push(tx);
      grouped.set(tx.bankAccountId, list);
    }

    const existingIndex = await this.loadBankTransactionIndex(clientId);
    const toRemove = new Set(existingIndex);
    const newIndex: string[] = [];

    for (const [accountId, accountTxs] of Array.from(grouped.entries())) {
      const result = await this.db.set(this.getBankTransactionsKey(clientId, accountId), accountTxs);
      if (!result.ok) {
        throw new Error(`Database error setting PJ bank transactions for ${clientId}:${accountId}: ${result.error?.message || JSON.stringify(result.error)}`);
      }
      toRemove.delete(accountId);
      newIndex.push(accountId);
    }

    for (const accountId of Array.from(toRemove)) {
      await this.db.delete(this.getBankTransactionsKey(clientId, accountId));
    }

    await this.saveBankTransactionIndex(clientId, newIndex);
  }

  async addBankTransactions(clientId: string, transactions: BankTransaction[]): Promise<void> {
    const grouped = new Map<string, BankTransaction[]>();
    for (const tx of transactions) {
      if (!tx.bankAccountId) {
        throw new Error("Bank transaction missing bankAccountId in addBankTransactions");
      }
      const list = grouped.get(tx.bankAccountId) ?? [];
      list.push(tx);
      grouped.set(tx.bankAccountId, list);
    }

    const index = await this.loadBankTransactionIndex(clientId);

    for (const [accountId, accountTxs] of Array.from(grouped.entries())) {
      const key = this.getBankTransactionsKey(clientId, accountId);
      const existingResult = await this.db.get(key);
      if (!existingResult.ok && existingResult.error?.statusCode !== 404) {
        throw new Error(`Database error getting PJ bank transactions for ${clientId}:${accountId}: ${existingResult.error?.message || JSON.stringify(existingResult.error)}`);
      }

      const existing = existingResult.ok ? ((existingResult.value as BankTransaction[] | null) ?? []) : [];
      const result = await this.db.set(key, [...existing, ...accountTxs]);
      if (!result.ok) {
        throw new Error(`Database error setting PJ bank transactions for ${clientId}:${accountId}: ${result.error?.message || JSON.stringify(result.error)}`);
      }

      if (!index.includes(accountId)) {
        index.push(accountId);
      }
    }

    await this.saveBankTransactionIndex(clientId, index);
  }

  async updateBankTransaction(clientId: string, bankTxId: string, updates: Partial<BankTransaction>): Promise<void> {
    let index = await this.loadBankTransactionIndex(clientId);
    if (index.length === 0) {
      const legacyResult = await this.db.get(this.getLegacyBankTransactionsKey(clientId));
      if (legacyResult.ok) {
        await this.migrateLegacyBankTransactions(clientId, legacyResult.value ?? []);
        index = await this.loadBankTransactionIndex(clientId);
      } else if (legacyResult.error && legacyResult.error.statusCode !== 404) {
        throw new Error(`Database error getting legacy bank transactions for ${clientId}: ${legacyResult.error?.message || JSON.stringify(legacyResult.error)}`);
      }
    }

    for (const accountId of index) {
      const key = this.getBankTransactionsKey(clientId, accountId);
      const result = await this.db.get(key);
      if (!result.ok) {
        if (result.error?.statusCode === 404) {
          continue;
        }
        throw new Error(`Database error getting PJ bank transactions for ${clientId}:${accountId}: ${result.error?.message || JSON.stringify(result.error)}`);
      }

      const transactions = (result.value as BankTransaction[] | null) ?? [];
      const idx = transactions.findIndex(tx => tx.bankTxId === bankTxId);
      if (idx === -1) {
        continue;
      }

      const updated = { ...transactions[idx], ...updates };
      updated.bankAccountId = updates.bankAccountId ?? transactions[idx].bankAccountId ?? accountId;
      transactions[idx] = updated;

      const setResult = await this.db.set(key, transactions);
      if (!setResult.ok) {
        throw new Error(`Database error updating PJ bank transactions for ${clientId}:${accountId}: ${setResult.error?.message || JSON.stringify(setResult.error)}`);
      }
      return;
    }

    throw new Error(`Bank transaction ${bankTxId} not found for client ${clientId}`);
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

  async getPjClientCategories(orgId: string, clientId: string): Promise<PjClientCategoryRecord[]> {
    const key = this.getPjClientCategoryKey(orgId, clientId);
    const result = await this.db.get(key);
    if (!result.ok && result.error?.statusCode !== 404) {
      throw new Error(
        `Database error getting PJ client categories for ${orgId}:${clientId}: ${result.error?.message || JSON.stringify(result.error)}`,
      );
    }
    if (!result.ok || !Array.isArray(result.value)) {
      return [];
    }
    return (result.value as PjClientCategoryRecord[]).map(category => ({ ...category }));
  }

  async setPjClientCategories(
    orgId: string,
    clientId: string,
    categories: PjClientCategoryRecord[],
  ): Promise<void> {
    const key = this.getPjClientCategoryKey(orgId, clientId);
    const payload = categories.map(category => ({ ...category }));
    const result = await this.db.set(key, payload);
    if (!result.ok) {
      throw new Error(
        `Database error setting PJ client categories for ${orgId}:${clientId}: ${result.error?.message || JSON.stringify(result.error)}`,
      );
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

  private getProcessedWebhookKey(key: string): string {
    return `processed_webhook:${key}`;
  }

  async registerProcessedWebhook(key: string, timestampIso: string): Promise<void> {
    const record = { timestampIso };
    const result = await this.db.set(this.getProcessedWebhookKey(key), record);
    if (!result.ok) {
      throw new Error(`Database error registering processed webhook ${key}: ${result.error?.message || JSON.stringify(result.error)}`);
    }
  }

  async hasProcessedWebhook(key: string): Promise<boolean> {
    const storageKey = this.getProcessedWebhookKey(key);
    const result = await this.db.get(storageKey);

    if (!result.ok) {
      if (result.error?.statusCode === 404) {
        return false;
      }
      throw new Error(`Database error checking processed webhook ${key}: ${result.error?.message || JSON.stringify(result.error)}`);
    }

    const value = result.value as { timestampIso?: string } | string | null;
    const timestampIso = typeof value === "string" ? value : value?.timestampIso;

    if (!timestampIso) {
      await this.db.delete(storageKey);
      return false;
    }

    const timestamp = Date.parse(timestampIso);
    if (Number.isNaN(timestamp)) {
      await this.db.delete(storageKey);
      return false;
    }

    if (Date.now() - timestamp > PROCESSED_WEBHOOK_RETENTION_MS) {
      await this.db.delete(storageKey);
      return false;
    }

    return true;
  }
}

// Use ReplitDbStorage by default when configuration is present
const defaultStorage: IStorage = process.env.REPLIT_DB_URL
  ? new ReplitDbStorage()
  : new MemStorage();

export let storage: IStorage = defaultStorage;

export function setStorageProvider<T extends IStorage>(next: T): T {
  storage = next;
  return next;
}
