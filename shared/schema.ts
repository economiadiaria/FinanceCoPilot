import { z } from "zod";

// Client types
export const clientTypes = ["PF", "PJ", "BOTH"] as const;

export const clientSchema = z.object({
  clientId: z.string().min(1, "ID do cliente é obrigatório"),
  name: z.string().min(1, "Nome é obrigatório"),
  type: z.enum(clientTypes),
  email: z.string().min(1, "Email é obrigatório").email("Email inválido"),
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

// Categorize transactions
export const categorizeSchema = z.object({
  clientId: z.string(),
  indices: z.array(z.number()),
  category: z.enum(transactionCategories),
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
