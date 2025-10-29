import { z } from "zod";

// Client types
export const clientTypes = ["PF", "PJ", "BOTH"] as const;

export const clientSchema = z.object({
  clientId: z.string().min(1, "ID do cliente é obrigatório"),
  name: z.string().min(1, "Nome é obrigatório"),
  type: z.enum(clientTypes),
  email: z.string().min(1, "Email é obrigatório").email("Email inválido"),
  organizationId: z.string().min(1, "Organização é obrigatória"),
  consultantId: z.string().min(1, "ID do consultor é obrigatório").optional().nullable(),
  masterId: z.string().min(1, "ID do usuário master é obrigatório").optional().nullable(),
});

export type Client = z.infer<typeof clientSchema>;
export type InsertClient = z.infer<typeof clientSchema>;

// Transaction types
export const transactionStatuses = ["pendente", "categorizada", "revisar"] as const;
export const transactionCategories = [
  "Receita",
  "Custo Fixo",
  "Custo Variável",
  "Impostos",
  "Lazer",
  "Taxas",
  "Investimento",
  "Outros"
] as const;

export const transactionSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  desc: z.string(),
  amount: z.number(), // positive = entrada, negative = saída
  category: z.enum(transactionCategories).optional(),
  subcategory: z.string().optional(),
  status: z.enum(transactionStatuses),
  fitid: z.string().optional(), // OFX unique transaction ID
  accountId: z.string().optional(), // Bank account ID from OFX
  bankName: z.string().optional(), // Nome do banco extraído do OFX
  // Open Finance fields
  provider: z.enum(["ofx", "pluggy"]).optional(), // Source of transaction
  providerTxId: z.string().optional(), // Pluggy transaction ID
  providerAccountId: z.string().optional(), // Pluggy account ID
});

export type Transaction = z.infer<typeof transactionSchema>;
export type InsertTransaction = z.infer<typeof transactionSchema>;

// Investment types
export const assetClasses = ["RF", "RV", "Fundos", "Outros"] as const;

export const positionSchema = z.object({
  asset: z.string(),
  class: z.enum(assetClasses),
  value: z.number(),
  rate: z.number().optional(), // taxa de retorno anual
  liquidity: z.string().optional(), // ex: "D+0", "D+1"
  maturity: z.string().optional(), // YYYY-MM-DD
  // Open Finance fields
  provider: z.enum(["manual", "pluggy"]).optional(), // Source of position
  providerPosId: z.string().optional(), // Pluggy position ID
  providerAccountId: z.string().optional(), // Pluggy account ID
});

export type Position = z.infer<typeof positionSchema>;
export type InsertPosition = z.infer<typeof positionSchema>;

// Policy types - PF
export const pfPolicySchema = z.object({
  targets: z.object({
    RF: z.number(),
    RV: z.number(),
    Fundos: z.number(),
    Outros: z.number(),
  }),
  rule50_30_20: z.boolean().optional(),
});

export type PFPolicy = z.infer<typeof pfPolicySchema>;

// Policy types - PJ
export const pjPolicySchema = z.object({
  cashPolicy: z.object({
    minRF: z.number(),
    maxRV: z.number(),
    maxIssuerPct: z.number(),
    maxDurationDays: z.number(),
  }),
});

export type PJPolicy = z.infer<typeof pjPolicySchema>;

// Report types
export const reportSchema = z.object({
  revenue: z.number(),
  costs: z.number(),
  profit: z.number(),
  margin: z.number(),
  ticketMedio: z.number().optional(),
  topCosts: z.array(z.object({
    category: z.string(),
    amount: z.number(),
  })).optional(),
  notes: z.string().optional(),
});

export type Report = z.infer<typeof reportSchema>;

// Categorize input - extends transaction categories with UI shortcuts
export const categorizeInputCategories = [
  ...transactionCategories,
  "Fixo",     // UI shortcut for "Custo Fixo"
  "Variável"  // UI shortcut for "Custo Variável"
] as const;

export const categorizeSchema = z.object({
  clientId: z.string(),
  indices: z.array(z.number()),
  category: z.enum(categorizeInputCategories),
  subcategory: z.string().optional(),
});

// Rebalance suggestion
export const rebalanceSuggestionSchema = z.object({
  class: z.string(),
  currentPct: z.number(),
  targetPct: z.number(),
  difference: z.number(),
  action: z.string(),
});

export type RebalanceSuggestion = z.infer<typeof rebalanceSuggestionSchema>;

// Summary response
export const summarySchema = z.object({
  totalIn: z.number(),
  totalOut: z.number(),
  balance: z.number(),
  revenue: z.number().optional(),
  costs: z.number().optional(),
  profit: z.number().optional(),
  margin: z.number().optional(),
  ticketMedio: z.number().optional(),
  topCosts: z.array(z.object({
    category: z.string(),
    amount: z.number(),
  })).optional(),
  insights: z.array(z.string()).optional(),
});

export type Summary = z.infer<typeof summarySchema>;

// User types and authentication
export const userRoles = ["master", "consultor", "cliente"] as const;

export const userSchema = z.object({
  userId: z.string().min(1, "ID do usuário é obrigatório"),
  email: z.string().min(1, "Email é obrigatório").email("Email inválido"),
  passwordHash: z.string().min(1, "Hash da senha é obrigatório"),
  role: z.enum(userRoles),
  name: z.string().min(1, "Nome é obrigatório"),
  organizationId: z.string().min(1, "Organização é obrigatória"),
  clientIds: z.array(z.string()).default([]),
  managedConsultantIds: z.array(z.string()).default([]),
  managedClientIds: z.array(z.string()).default([]),
  managerId: z.string().optional(),
  consultantId: z.string().optional(),
});

export type User = z.infer<typeof userSchema>;

export const userProfileSchema = userSchema.omit({ passwordHash: true });
export type UserProfile = z.infer<typeof userProfileSchema>;

export const registerUserSchema = userSchema
  .omit({ userId: true, passwordHash: true, organizationId: true })
  .extend({
    password: z.string().min(6, "Senha deve ter no mínimo 6 caracteres"),
    organizationId: z.string().optional(),
  });

export type RegisterUser = z.infer<typeof registerUserSchema>;

export const loginRequestSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(1, "Senha é obrigatória"),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const authResponseSchema = z.object({
  user: userSchema.omit({ passwordHash: true }),
});

export const auditEventTypes = [
  "auth.login",
  "auth.logout",
  "user.create",
  "user.update",
  "client.create",
  "client.update",
  "pj.sale.create",
  "pj.sale.update",
  "pj.sale.reconcile",
  "pj.ofx.import",
  "pj.transaction.update",
  "policy.update",
  "report.generate",
  "lgpd.anonymize",
  "openfinance.webhook.accepted",
  "openfinance.webhook.rejected",
] as const;

export const auditLogEntrySchema = z.object({
  auditId: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  actorRole: z.enum(userRoles),
  eventType: z.enum(auditEventTypes),
  targetType: z.string(),
  targetId: z.string().optional(),
  createdAt: z.string(),
  metadata: z.record(z.string(), z.any()).default({}),
  piiSnapshot: z.record(z.string(), z.string()).optional(),
});

export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

export type AuthResponse = z.infer<typeof authResponseSchema>;

// OFX import history (to prevent duplicate file uploads)
export const ofxImportSchema = z.object({
  fileHash: z.string(), // SHA256 hash of OFX file content
  clientId: z.string(),
  bankAccountId: z.string(),
  importedAt: z.string(), // ISO 8601 timestamp
  transactionCount: z.number(),
  statementStart: z.string().optional(),
  statementEnd: z.string().optional(),
  reconciliation: z
    .object({
      accounts: z
        .array(
          z.object({
            accountId: z.string(),
            currency: z.string().optional(),
            startDate: z.string().optional(),
            endDate: z.string().optional(),
            openingBalance: z.number().optional(),
            ledgerClosingBalance: z.number().optional(),
            computedClosingBalance: z.number().optional(),
            totalCredits: z.number(),
            totalDebits: z.number(),
            net: z.number(),
            divergence: z.number().optional(),
          })
        )
        .default([]),
      warnings: z.array(z.string()).default([]),
    })
    .optional(),
});

export type OFXImport = z.infer<typeof ofxImportSchema>;

// Open Finance (Pluggy) types
export const ofItemSchema = z.object({
  itemId: z.string(),
  institutionName: z.string(),
  status: z.enum(["active", "error", "waiting_user_input", "login_error"]),
  lastSyncAt: z.string().optional(), // ISO 8601 timestamp
  createdAt: z.string(), // ISO 8601 timestamp
});

export type OFItem = z.infer<typeof ofItemSchema>;

export const ofAccountSchema = z.object({
  accountId: z.string(),
  itemId: z.string(),
  name: z.string(),
  type: z.string(), // CHECKING, SAVINGS, CREDIT_CARD, INVESTMENT
  currency: z.string().default("BRL"),
  balance: z.number().optional(),
});

export type OFAccount = z.infer<typeof ofAccountSchema>;

export const ofSyncMetaSchema = z.object({
  lastTxSyncAt: z.string().optional(), // ISO 8601 timestamp
  lastPosSyncAt: z.string().optional(), // ISO 8601 timestamp
});

export type OFSyncMeta = z.infer<typeof ofSyncMetaSchema>;

// ============================================================================
// PJ (Pessoa Jurídica) Types
// ============================================================================

// Payment Method Configuration (PJ)
export const paymentMethodSchema = z.object({
  id: z.string(),
  name: z.string(), // ex: "PIX", "Crédito Visa"
  gateway: z.string().optional(), // ex: "stripe", "mercadopago"
  taxaPct: z.number().optional(), // taxa percentual
  taxaFixa: z.number().optional(), // taxa fixa
  liquidacao: z.string().optional(), // "D+X", "D+30_por_parcela", "D+1"
  metadata: z.record(z.any()).optional(),
});

export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

// Sale Leg (multi-pagamento) - PJ
export const saleLegStatuses = ["autorizado", "pago", "liquidado", "estornado", "chargeback", "cancelado"] as const;
export const paymentMethods = ["pix", "credito", "debito", "boleto", "dinheiro", "transferencia", "link", "gateway", "outro"] as const;
export const reconciliationStates = ["pendente", "parcial", "conciliado", "divergente"] as const;

export const settlementParcelSchema = z.object({
  n: z.number(), // número da parcela
  due: z.string(), // DD/MM/YYYY
  expected: z.number(), // valor esperado
  receivedTxId: z.string().optional(), // ID da transação bancária
  receivedAt: z.string().optional(), // DD/MM/YYYY
});

export const saleLegEventSchema = z.object({
  type: z.enum(["created", "authorized", "paid", "settled", "refund", "chargeback"]),
  at: z.string(), // DD/MM/YYYY
  meta: z.record(z.any()).optional(),
});

export const saleLegSchema = z.object({
  saleLegId: z.string(),
  saleId: z.string(),
  method: z.enum(paymentMethods),
  gateway: z.string().optional(),
  authorizedCode: z.string().optional(),
  installments: z.number().default(1),
  grossAmount: z.number(),
  fees: z.number(),
  netAmount: z.number(),
  status: z.enum(saleLegStatuses),
  provider: z.enum(["manual", "gateway", "pluggy"]).default("manual"),
  providerPaymentId: z.string().optional(),
  providerAccountId: z.string().optional(),
  settlementPlan: z.array(settlementParcelSchema),
  reconciliation: z.object({
    state: z.enum(reconciliationStates),
    notes: z.string().optional(),
  }),
  events: z.array(saleLegEventSchema),
});

export type SaleLeg = z.infer<typeof saleLegSchema>;
export type SettlementParcel = z.infer<typeof settlementParcelSchema>;

// Sale (venda header) - PJ
export const saleStatuses = ["aberta", "fechada", "cancelada"] as const;

export const saleSchema = z.object({
  saleId: z.string(),
  date: z.string(), // DD/MM/YYYY
  invoiceNumber: z.string().optional(),
  customer: z.object({
    name: z.string(),
    doc: z.string().optional(), // CPF/CNPJ
    email: z.string().optional(),
    telefone: z.string().optional(),
  }),
  channel: z.string(), // "loja", "ecommerce", "marketplace", etc.
  status: z.enum(saleStatuses),
  grossAmount: z.number(),
  netAmount: z.number(),
  comment: z.string().optional(),
  legs: z.array(z.string()), // IDs dos sale legs
});

export type Sale = z.infer<typeof saleSchema>;

// Ledger Entry (lançamento contábil) - PJ
export const ledgerGroups = ["RECEITA", "DEDUCOES_RECEITA", "GEA", "COMERCIAL_MKT", "FINANCEIRAS", "OUTRAS"] as const;
export const ledgerOrigins = ["sale_leg", "manual", "bank", "gateway"] as const;

export const ledgerEntrySchema = z.object({
  id: z.string(),
  group: z.enum(ledgerGroups),
  subcategory: z.string().optional(),
  amount: z.number(), // positivo ou negativo
  recognizedAt: z.string(), // DD/MM/YYYY - competência
  cashAt: z.string().optional(), // DD/MM/YYYY - caixa
  excludeFromMargin: z.boolean().default(false),
  origin: z.enum(ledgerOrigins),
  saleId: z.string().optional(),
  saleLegId: z.string().optional(),
  note: z.string().optional(),
});

export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

// Bank Transaction (PJ)
export const bankTransactionSchema = z.object({
  bankTxId: z.string(),
  date: z.string(), // DD/MM/YYYY
  desc: z.string(),
  amount: z.number(), // positivo = entrada, negativo = saída
  bankAccountId: z.string(),
  accountId: z.string().optional(),
  fitid: z.string().optional(), // OFX unique ID
  sourceHash: z.string().optional(), // SHA256 do arquivo OFX
  linkedLegs: z.array(z.object({
    saleLegId: z.string(),
    nParcela: z.number().optional(),
  })).default([]),
  reconciled: z.boolean().default(false),
  categorizedAs: z.object({
    group: z.enum(ledgerGroups).optional(),
    subcategory: z.string().optional(),
    auto: z.boolean().default(false), // categorização automática?
  }).optional(),
  // Campos de categorização DFC (compatibilidade com código existente)
  dfcCategory: z.string().optional(),
  dfcItem: z.string().optional(),
  categorizedBy: z.enum(["manual", "rule", "auto"]).optional(),
  categorizedRuleId: z.string().optional(),
});

export type BankTransaction = z.infer<typeof bankTransactionSchema>;

// Bank Accounts
export const bankAccountProviders = ["manual", "ofx", "pluggy", "manual-ofx"] as const;

export const bankAccountSchema = z.object({
  id: z.string().min(1, "ID da conta bancária é obrigatório"),
  orgId: z.string().min(1, "ID da organização é obrigatório"),
  clientId: z.string().min(1, "ID do cliente é obrigatório"),
  provider: z.enum(bankAccountProviders),
  bankOrg: z.string().optional().nullable(),
  bankFid: z.string().optional().nullable(),
  bankName: z.string().min(1, "Nome do banco é obrigatório"),
  bankCode: z.string().optional().nullable(),
  branch: z.string().optional().nullable(),
  accountNumberMask: z.string().min(1, "Máscara da conta é obrigatória"),
  accountType: z.string().min(1, "Tipo da conta é obrigatório"),
  currency: z.string().min(1, "Moeda é obrigatória"),
  accountFingerprint: z.string().min(1, "Fingerprint da conta é obrigatório"),
  isActive: z.boolean(),
  createdAt: z.string().min(1, "Data de criação é obrigatória"),
  updatedAt: z.string().min(1, "Data de atualização é obrigatória"),
});

export type BankAccount = z.infer<typeof bankAccountSchema>;
export type UpsertBankAccount = z.infer<typeof bankAccountSchema>;

const summarySnapshotValueSchema = z.union([
  z.number(),
  z.string(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);

export const bankSummarySnapshotSchema = z.object({
  organizationId: z.string().min(1, "Organização é obrigatória"),
  clientId: z.string().min(1, "Cliente é obrigatório"),
  bankAccountId: z.string().min(1, "Conta bancária é obrigatória"),
  window: z.string().min(1, "Janela de tempo é obrigatória"),
  totals: z.record(z.string(), summarySnapshotValueSchema).default({}),
  kpis: z.record(z.string(), summarySnapshotValueSchema).default({}),
  refreshedAt: z.string().min(1, "Timestamp de atualização é obrigatório"),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type BankSummarySnapshot = z.infer<typeof bankSummarySnapshotSchema>;

// Categorization Rule (aprendizado) - PJ
export const matchTypes = ["exact", "contains", "startsWith"] as const;
export const categorizationActionTypes = ["link_to_sale", "categorize_as_expense"] as const;

export const categorizationRuleSchema = z.object({
  ruleId: z.string(),
  pattern: z.string(), // "STRIPE*", "exact description"
  matchType: z.enum(matchTypes),
  action: z.object({
    type: z.enum(categorizationActionTypes),
    category: z.enum(ledgerGroups).optional(),
    subcategory: z.string().optional(),
    autoConfirm: z.boolean().default(false),
  }),
  confidence: z.number().min(0).max(100), // 0-100
  learnedFrom: z.object({
    bankTxId: z.string(),
    date: z.string(), // DD/MM/YYYY
  }),
  appliedCount: z.number().default(0),
  enabled: z.boolean().default(true),
  createdAt: z.string().optional(), // ISO timestamp
  // Campos DFC (compatibilidade com código existente)
  dfcCategory: z.string().optional(),
  dfcItem: z.string().optional(),
});

export type CategorizationRule = z.infer<typeof categorizationRuleSchema>;

// DFC (Demonstrativo de Fluxo de Caixa) - PJ
export const dfcSchema = z.object({
  period: z.string(), // AAAA-MM
  caixaInicial: z.number().optional(),
  operacional: z.object({
    in: z.number(),
    out: z.number(),
    net: z.number(),
  }),
  investimento: z.object({
    in: z.number(),
    out: z.number(),
    net: z.number(),
  }),
  financiamento: z.object({
    in: z.number(),
    out: z.number(),
    net: z.number(),
  }),
  caixaFinal: z.number(),
});

export type DFC = z.infer<typeof dfcSchema>;
