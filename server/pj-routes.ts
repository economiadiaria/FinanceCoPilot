import type { Express } from "express";
import { storage } from "./storage";
import { scopeRequired, ensureBankAccountAccess } from "./middleware/scope";
import multer from "multer";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import Ofx from "ofx-js";
import {
  type Sale,
  type SaleLeg,
  type BankTransaction,
  type CategorizationRule,
  type OFXImport,
} from "@shared/schema";
import {
  formatBR,
  toISOFromBR,
  isBetweenDates,
  maskPIIValue,
} from "@shared/utils";
import {
  applyCategorizationRules,
  calculateSettlementPlan,
  extractPattern,
  isDuplicateTransaction,
  matchesPattern,
  normalizeOfxAmount,
} from "./pj-ingestion-helpers";
import { buildCostBreakdown, buildMonthlyInsights } from "./pj-dashboard-helpers";
import { z } from "zod";
import { recordAuditEvent } from "./security/audit";
import { getLogger } from "./observability/logger";
import {
  ofxIngestionDuration,
  startOfxIngestionTimer,
  recordOfxIngestionDuration,
  incrementOfxError,
} from "./observability/metrics";
import { recordOfxImportOutcome } from "./observability/alerts";

const ofxTransactionSchema = z.object({
  DTPOSTED: z.string().min(1, "Transação OFX sem DTPOSTED"),
  TRNAMT: z.string().min(1, "Transação OFX sem TRNAMT"),
  TRNTYPE: z.string().optional(),
  FITID: z.string().optional(),
  UNIQUEID: z.string().optional(),
  REFNUM: z.string().optional(),
  CHECKNUM: z.string().optional(),
  NAME: z.string().optional(),
  MEMO: z.string().optional(),
});

const ofxStatementSchema = z.object({
  STMTRS: z.object({
    CURDEF: z.string().optional(),
    BANKACCTFROM: z
      .object({
        ACCTID: z.string().optional(),
        BANKID: z.string().optional(),
        BRANCHID: z.string().optional(),
      })
      .optional(),
    BANKTRANLIST: z
      .object({
        DTSTART: z.string().optional(),
        DTEND: z.string().optional(),
        STMTTRN: z.union([ofxTransactionSchema, z.array(ofxTransactionSchema)]),
      })
      .passthrough(),
    LEDGERBAL: z
      .object({
        BALAMT: z.string(),
        DTASOF: z.string().optional(),
      })
      .optional(),
  }),
});

// Configure multer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

const UNKNOWN_BANK_LABEL = "unknown";

function coerceBankLabel(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function maskBankLabel(value: unknown): string {
  const normalized = coerceBankLabel(value);
  if (!normalized || normalized.toLowerCase() === UNKNOWN_BANK_LABEL) {
    return UNKNOWN_BANK_LABEL;
  }

  const masked = maskPIIValue("bankName", normalized);
  return typeof masked === "string" ? masked : String(masked);
}

function maskAccountNumber(accountId: unknown): string {
  const normalized = coerceBankLabel(accountId);
  if (!normalized) {
    return UNKNOWN_BANK_LABEL;
  }

  const digits = normalized.replace(/\D/g, "");
  if (digits.length >= 4) {
    return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
  }

  if (normalized.length >= 4) {
    return `${"*".repeat(Math.max(0, normalized.length - 4))}${normalized.slice(-4)}`;
  }

  return "***";
}

function coerceClientIdValue(input: unknown): string | undefined {
  if (Array.isArray(input)) {
    for (const candidate of input) {
      if (typeof candidate === "string") {
        const trimmed = candidate.trim();
        if (trimmed) {
          return trimmed;
        }
      }
    }
    return undefined;
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    return trimmed === "" ? undefined : trimmed;
  }

  return undefined;
}

function buildAccountAuditMetadata(
  accountIds: Iterable<string | undefined | null>
): Array<{ bankAccountId: string; accountNumberMask: string }> {
  const seen = new Set<string>();
  const entries: Array<{ bankAccountId: string; accountNumberMask: string }> = [];
  const normalizedAccountIds = Array.from(accountIds);

  for (const maybeId of normalizedAccountIds) {
    if (!maybeId) {
      continue;
    }
    if (seen.has(maybeId)) {
      continue;
    }
    seen.add(maybeId);
    entries.push({ bankAccountId: maybeId, accountNumberMask: maskAccountNumber(maybeId) });
  }

  return entries;
}

function extractMaskedBankNameFromStatement(statement: any, fallbackBankName?: unknown): string {
  const candidates = [
    statement?.BANKACCTFROM?.BANKNAME,
    statement?.BANKACCTFROM?.BANKID,
    statement?.BANKACCTFROM?.BRANCHID,
    statement?.CCACCTFROM?.BANKNAME,
    statement?.CCACCTFROM?.BANKID,
    statement?.CCACCTFROM?.BRANCHID,
    fallbackBankName,
  ];

  for (const candidate of candidates) {
    const normalized = coerceBankLabel(candidate);
    if (!normalized) {
      continue;
    }
    return maskBankLabel(normalized);
  }

  return UNKNOWN_BANK_LABEL;
}

export function registerPJRoutes(app: Express) {
  // ===== VENDAS PJ =====

  /**
   * POST /api/pj/sales/add
   * Inclusão manual de venda com multi-pagamento
   */
  app.post("/api/pj/sales/add", scopeRequired("PJ"), async (req, res) => {
    try {
      const schema = z.object({
        clientId: z.string(),
        date: z.string(), // DD/MM/YYYY
        invoiceNumber: z.string().optional(),
        customer: z.object({
          name: z.string(),
          doc: z.string().optional(),
          email: z.string().optional(),
          telefone: z.string().optional(),
        }),
        channel: z.string(),
        comment: z.string().optional(),
        legs: z.array(z.object({
          method: z.enum(["pix", "credito", "debito", "boleto", "dinheiro", "transferencia", "link", "gateway", "outro"]),
          gateway: z.string().optional(),
          installments: z.number().default(1),
          grossAmount: z.number(),
          fees: z.number(),
          authorizedCode: z.string().optional(),
        })),
      });
      
      const data = schema.parse(req.body);
      const { clientId } = data;
      
      // Buscar métodos de pagamento configurados
      const paymentMethods = await storage.getPaymentMethods(clientId);
      
      // Criar IDs
      const saleId = uuidv4();
      const legIds: string[] = [];
      
      // Criar legs
      const saleLegs: SaleLeg[] = [];
      let totalGross = 0;
      let totalNet = 0;
      
      for (const legData of data.legs) {
        const saleLegId = uuidv4();
        legIds.push(saleLegId);
        
        const netAmount = legData.grossAmount - legData.fees;
        totalGross += legData.grossAmount;
        totalNet += netAmount;
        
        // Encontrar configuração do método
        const methodConfig = paymentMethods.find(m => 
          m.name.toLowerCase().includes(legData.method.toLowerCase()) ||
          m.gateway?.toLowerCase() === legData.gateway?.toLowerCase()
        );
        
        // Calcular settlement plan
        const settlementPlan = calculateSettlementPlan(
          data.date,
          methodConfig,
          legData.installments,
          netAmount
        );
        
        const leg: SaleLeg = {
          saleLegId,
          saleId,
          method: legData.method,
          gateway: legData.gateway,
          authorizedCode: legData.authorizedCode,
          installments: legData.installments,
          grossAmount: legData.grossAmount,
          fees: legData.fees,
          netAmount,
          status: "autorizado",
          provider: "manual",
          settlementPlan,
          reconciliation: {
            state: "pendente",
          },
          events: [{
            type: "created",
            at: data.date,
          }],
        };
        
        saleLegs.push(leg);
      }
      
      // Criar venda
      const sale: Sale = {
        saleId,
        date: data.date,
        invoiceNumber: data.invoiceNumber,
        customer: data.customer,
        channel: data.channel,
        status: "aberta",
        grossAmount: totalGross,
        netAmount: totalNet,
        comment: data.comment,
        legs: legIds,
      };
      
      // Salvar
      await storage.addSale(clientId, sale);
      const existingLegs = await storage.getSaleLegs(clientId);
      await storage.setSaleLegs(clientId, [...existingLegs, ...saleLegs]);

      await recordAuditEvent({
        user: req.authUser!,
        eventType: "pj.sale.create",
        targetType: "sale",
        targetId: saleId,
        metadata: { clientId, legs: saleLegs.length, channel: data.channel },
        piiSnapshot: {
          customerName: data.customer.name,
          customerEmail: data.customer.email,
          customerDoc: data.customer.doc,
        },
      });
      
      res.json({ 
        success: true, 
        sale,
        legs: saleLegs,
      });
    } catch (error: any) {
      getLogger(req).error("Erro ao adicionar venda PJ", {
        event: "pj.sales.create",
        context: { clientId: req.body?.clientId },
      }, error);
      res.status(400).json({ error: error.message || "Erro ao adicionar venda" });
    }
  });
  
  /**
   * GET /api/pj/sales/list
   * Listagem de vendas com filtros
   */
  app.get("/api/pj/sales/list", scopeRequired("PJ"), async (req, res) => {
    try {
      const clientId = req.query.clientId as string;
      const from = req.query.from as string | undefined; // DD/MM/YYYY
      const to = req.query.to as string | undefined; // DD/MM/YYYY
      const status = req.query.status as string | undefined;
      const method = req.query.method as string | undefined;
      const channel = req.query.channel as string | undefined;
      
      let sales = await storage.getSales(clientId);
      const allLegs = await storage.getSaleLegs(clientId);
      
      // Filtros
      if (from) {
        const fromISO = toISOFromBR(from);
        sales = sales.filter(s => toISOFromBR(s.date) >= fromISO);
      }
      
      if (to) {
        const toISO = toISOFromBR(to);
        sales = sales.filter(s => toISOFromBR(s.date) <= toISO);
      }
      
      if (status) {
        sales = sales.filter(s => s.status === status);
      }
      
      if (channel) {
        sales = sales.filter(s => s.channel === channel);
      }
      
      if (method) {
        // Filtrar por método de pagamento
        const salesWithMethod = new Set<string>();
        allLegs.forEach(leg => {
          if (leg.method === method) {
            salesWithMethod.add(leg.saleId);
          }
        });
        sales = sales.filter(s => salesWithMethod.has(s.saleId));
      }
      
      // Enriquecer com legs
      const salesWithLegs = sales.map(sale => {
        const legs = allLegs.filter(l => sale.legs.includes(l.saleLegId));
        return {
          ...sale,
          legsData: legs,
        };
      });
      
      res.json({ sales: salesWithLegs });
    } catch (error: any) {
      getLogger(req).error("Erro ao listar vendas PJ", {
        event: "pj.sales.list",
        context: { clientId: req.query?.clientId },
      }, error);
      res.status(500).json({ error: error.message || "Erro ao listar vendas" });
    }
  });
  
  /**
   * GET /api/pj/sales/legs
   * Lista todas as sale legs de um cliente
   */
  app.get("/api/pj/sales/legs", scopeRequired("PJ"), async (req, res) => {
    try {
      const clientId = req.query.clientId as string;
      if (!clientId) {
        return res.status(400).json({ error: "clientId é obrigatório" });
      }
      
      const legs = await storage.getSaleLegs(clientId);
      res.json({ legs });
    } catch (error: any) {
      getLogger(req).error("Erro ao listar sale legs", {
        event: "pj.sales.legs",
        context: { clientId: req.query?.clientId },
      }, error);
      res.status(500).json({ error: error.message || "Erro ao listar sale legs" });
    }
  });
  
  /**
   * POST /api/pj/sales/importCsv
   * Importação de vendas via CSV
   * Formato: date;invoiceNumber;customer_name;customer_doc;channel;item;qty;unit_price;discount;payment_method;gateway;installments;gross_leg;fees_leg;status;comment
   */
  app.post("/api/pj/sales/importCsv", scopeRequired("PJ"), upload.single("csv"), async (req, res) => {
    let currentClientId: string | null = null;
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Arquivo CSV não enviado" });
      }

      const candidateClientId = (req.body?.clientId ?? req.query?.clientId) as
        | string
        | string[]
        | undefined;
      const resolvedClientId = Array.isArray(candidateClientId)
        ? candidateClientId[0]
        : candidateClientId;

      if (typeof resolvedClientId !== "string" || resolvedClientId.trim() === "") {
        return res.status(400).json({ error: "clientId é obrigatório" });
      }

      const clientId = resolvedClientId.trim();
      currentClientId = clientId;

      // Parse CSV
      const csvContent = req.file.buffer.toString("utf-8");
      const lines = csvContent.split("\n").filter(l => l.trim());
      
      if (lines.length === 0) {
        return res.status(400).json({ error: "CSV vazio" });
      }
      
      // Skip header
      const dataLines = lines.slice(1);
      
      // Agrupar por invoiceNumber + date
      const salesMap = new Map<string, {
        date: string;
        invoiceNumber: string;
        customer: { name: string; doc?: string };
        channel: string;
        comment?: string;
        legs: any[];
      }>();
      
      const paymentMethods = await storage.getPaymentMethods(clientId);
      
      for (const line of dataLines) {
        const parts = line.split(";");
        if (parts.length < 10) continue; // Skip invalid lines
        
        const [
          date, invoiceNumber, customer_name, customer_doc, channel,
          item, qty, unit_price, discount, payment_method, gateway,
          installments, gross_leg, fees_leg, status, comment
        ] = parts.map(p => p.trim());
        
        const key = `${invoiceNumber || date}-${date}`;
        
        if (!salesMap.has(key)) {
          salesMap.set(key, {
            date,
            invoiceNumber,
            customer: { name: customer_name, doc: customer_doc },
            channel,
            comment,
            legs: [],
          });
        }
        
        const saleData = salesMap.get(key)!;
        saleData.legs.push({
          method: payment_method.toLowerCase() as any,
          gateway,
          installments: parseInt(installments) || 1,
          grossAmount: parseFloat(gross_leg),
          fees: parseFloat(fees_leg),
          status,
        });
      }
      
      // Criar vendas
      const existingSales = await storage.getSales(clientId);
      const existingLegs = await storage.getSaleLegs(clientId);
      
      const newSales: Sale[] = [];
      const newLegs: SaleLeg[] = [];
      let imported = 0;
      let skipped = 0;
      
      for (const [key, saleData] of Array.from(salesMap)) {
        // Dedup: verificar se já existe venda com mesmo invoiceNumber e data
        const exists = existingSales.find(s => 
          s.invoiceNumber === saleData.invoiceNumber && s.date === saleData.date
        );
        
        if (exists) {
          skipped++;
          continue;
        }
        
        const saleId = uuidv4();
        const legIds: string[] = [];
        let totalGross = 0;
        let totalNet = 0;
        
        for (const legData of saleData.legs) {
          const saleLegId = uuidv4();
          legIds.push(saleLegId);
          
          const netAmount = legData.grossAmount - legData.fees;
          totalGross += legData.grossAmount;
          totalNet += netAmount;
          
          const methodConfig = paymentMethods.find(m =>
            m.name.toLowerCase().includes(legData.method) ||
            m.gateway?.toLowerCase() === legData.gateway?.toLowerCase()
          );
          
          const settlementPlan = calculateSettlementPlan(
            saleData.date,
            methodConfig,
            legData.installments,
            netAmount
          );
          
          const leg: SaleLeg = {
            saleLegId,
            saleId,
            method: legData.method,
            gateway: legData.gateway,
            installments: legData.installments,
            grossAmount: legData.grossAmount,
            fees: legData.fees,
            netAmount,
            status: legData.status || "autorizado",
            provider: "manual",
            settlementPlan,
            reconciliation: { state: "pendente" },
            events: [{ type: "created", at: saleData.date }],
          };
          
          newLegs.push(leg);
        }
        
        const sale: Sale = {
          saleId,
          date: saleData.date,
          invoiceNumber: saleData.invoiceNumber,
          customer: saleData.customer,
          channel: saleData.channel,
          status: "aberta",
          grossAmount: totalGross,
          netAmount: totalNet,
          comment: saleData.comment,
          legs: legIds,
        };
        
        newSales.push(sale);
        imported++;
      }
      
      // Salvar
      await storage.setSales(clientId, [...existingSales, ...newSales]);
      await storage.setSaleLegs(clientId, [...existingLegs, ...newLegs]);

      await recordAuditEvent({
        user: req.authUser!,
        eventType: "pj.sale.create",
        targetType: "sale-batch",
        metadata: { clientId, imported, skipped, total: salesMap.size },
      });

      res.json({
        success: true,
        imported,
        skipped,
        total: salesMap.size,
      });
    } catch (error: any) {
      getLogger(req).error("Erro ao importar CSV de vendas", {
        event: "pj.sales.importCsv",
        context: { clientId: req.body?.clientId ?? req.query?.clientId },
      }, error);
      res.status(500).json({ error: error.message || "Erro ao importar CSV" });
    }
  });

  app.get(
    "/api/pj/accounts",
    scopeRequired("PJ"),
    async (req, res) => {
      try {
        const client = req.clientContext;
        if (!client) {
          return res.status(500).json({ error: "Contexto do cliente não carregado" });
        }

        const accounts = await storage.getBankAccounts(
          client.organizationId,
          client.clientId
        );

        const mappedAccounts = accounts.map(account => ({
          id: account.id,
          bankName: account.bankName,
          accountNumberMask: account.accountNumberMask,
          accountType: account.accountType,
          currency: account.currency,
          isActive: account.isActive,
        }));

        const responseBody = { accounts: mappedAccounts };
        const serializedPayload = JSON.stringify(responseBody);
        const etagHash = crypto.createHash("sha256").update(serializedPayload).digest("hex");

        const requestIdHeader =
          res.getHeader("X-Request-Id") ?? req.headers["x-request-id"] ?? req.requestId;
        if (requestIdHeader) {
          const normalizedRequestId = Array.isArray(requestIdHeader)
            ? requestIdHeader[0]
            : typeof requestIdHeader === "string"
              ? requestIdHeader
              : String(requestIdHeader);
          res.setHeader("X-Request-Id", normalizedRequestId);
        }

        res.setHeader("Cache-Control", "private, max-age=60");
        res.setHeader("ETag", `"${etagHash}"`);

        res.json(responseBody);
      } catch (error: any) {
        getLogger(req).error(
          "Erro ao listar contas bancárias",
          { event: "pj.accounts.list" },
          error
        );
        res.status(500).json({ error: error.message ?? "Erro ao listar contas bancárias" });
      }
    }
  );

  // ===== BANCO PJ =====

  /**
   * GET /api/pj/transactions
   * Lista transações bancárias paginadas de um cliente
   */
  app.get(
    "/api/pj/transactions",
    scopeRequired("PJ"),
    ensureBankAccountAccess,
    async (req, res) => {
      try {
        const clientId = req.query.clientId as string;
        if (!clientId) {
          return res.status(400).json({ error: "clientId é obrigatório" });
        }

        const bankAccount = req.bankAccountContext;
        if (!bankAccount) {
          return res.status(500).json({ error: "Contexto da conta bancária não carregado" });
        }

        const pickSingle = (value: unknown): string | undefined => {
          if (Array.isArray(value)) {
            return value[0];
          }
          return typeof value === "string" ? value : undefined;
        };

        const sortParam = pickSingle(req.query.sort)?.toLowerCase();
        const sortDirection: "asc" | "desc" = sortParam === "asc" ? "asc" : "desc";

        const parsePositiveInt = (value: string | undefined, fallback: number, max?: number): number => {
          if (!value) {
            return fallback;
          }
          const parsed = Number.parseInt(value, 10);
          if (!Number.isFinite(parsed) || parsed <= 0) {
            return fallback;
          }
          if (max && parsed > max) {
            return max;
          }
          return parsed;
        };

        const page = parsePositiveInt(pickSingle(req.query.page), 1);
        const limit = parsePositiveInt(pickSingle(req.query.limit), 50, 200);

        let fromISO: string | undefined;
        let toISO: string | undefined;

        try {
          const fromParam = pickSingle(req.query.from)?.trim();
          if (fromParam) {
            fromISO = toISOFromBR(fromParam);
          }
        } catch (error) {
          return res.status(400).json({ error: "Data inicial inválida" });
        }

        try {
          const toParam = pickSingle(req.query.to)?.trim();
          if (toParam) {
            toISO = toISOFromBR(toParam);
          }
        } catch (error) {
          return res.status(400).json({ error: "Data final inválida" });
        }

        if (fromISO && toISO && fromISO > toISO) {
          return res.status(400).json({ error: "Período inválido" });
        }

        const transactions = await storage.getBankTransactions(clientId, bankAccount.id);

        const normalized = transactions.map(tx => ({
          tx,
          isoDate: toISOFromBR(tx.date),
        }));

        const filtered = normalized.filter(({ isoDate }) => {
          if (fromISO && isoDate < fromISO) {
            return false;
          }
          if (toISO && isoDate > toISO) {
            return false;
          }
          return true;
        });

        const sorted = filtered.sort((a, b) => {
          if (a.isoDate === b.isoDate) {
            if (sortDirection === "asc") {
              return a.tx.bankTxId.localeCompare(b.tx.bankTxId);
            }
            return b.tx.bankTxId.localeCompare(a.tx.bankTxId);
          }
          if (sortDirection === "asc") {
            return a.isoDate.localeCompare(b.isoDate);
          }
          return b.isoDate.localeCompare(a.isoDate);
        });

        const totalItems = sorted.length;
        const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);
        const start = (page - 1) * limit;
        const pageItems = start >= 0 ? sorted.slice(start, start + limit) : sorted.slice(0, limit);
        const items = pageItems.map(item => item.tx);

        const pagination = {
          page,
          limit,
          totalItems,
          totalPages,
          hasNextPage: start + limit < totalItems,
          hasPreviousPage: page > 1 && totalItems > 0,
        };

        const responseBody = { items, pagination };
        const etagHash = crypto.createHash("sha256").update(JSON.stringify(responseBody)).digest("hex");
        const etagValue = `"${etagHash}"`;

        res.setHeader("ETag", etagValue);
        res.setHeader("Cache-Control", "private, max-age=30");

        const ifNoneMatch = pickSingle(req.headers["if-none-match"]);
        if (ifNoneMatch) {
          const candidates = ifNoneMatch.split(/\s*,\s*/);
          if (candidates.includes(etagValue) || candidates.includes("*")) {
            return res.status(304).end();
          }
        }

        res.json(responseBody);
      } catch (error: any) {
        getLogger(req).error("Erro ao listar transações bancárias", {
          event: "pj.bank.list",
          context: { clientId: req.query?.clientId },
        }, error);
        res.status(500).json({ error: error.message || "Erro ao listar transações" });
      }
    }
  );
  
  /**
   * POST /api/pj/import/ofx
   * Importar extrato bancário via OFX com deduplicação SHA256
   */
  app.post("/api/pj/import/ofx", upload.single("ofx"), scopeRequired("PJ"), async (req, res) => {
    const baseLogger = getLogger(req);
    const importId = crypto.randomUUID();
    let ingestionLogger = baseLogger.child({ importId });
    const activeTimers = new Map<string, ReturnType<typeof startOfxIngestionTimer>>();
    let warnings: string[] = [];
    let errorStage = "initial";
    let currentClientId: string | null = null;
    let ingestionStartedAt: bigint | null = null;

    try {
      if (!req.file) {
        return res.status(400).json({ error: "Arquivo OFX não enviado" });
      }

      const candidateClientId = (req.body?.clientId ?? req.query?.clientId) as
        | string
        | string[]
        | undefined;
      const resolvedClientId = Array.isArray(candidateClientId)
        ? candidateClientId[0]
        : candidateClientId;

      if (typeof resolvedClientId !== "string" || resolvedClientId.trim() === "") {
        return res.status(400).json({ error: "clientId é obrigatório" });
      }

      const clientId = resolvedClientId.trim();
      currentClientId = clientId;

      ingestionStartedAt = process.hrtime.bigint();

      const buffer = req.file.buffer;
      const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");

      ingestionLogger.info("Arquivo OFX recebido", {
        event: "pj.ofx.import.file",
        context: {
          fileHash,
          duplicateFile: false,
        },
      });

      let fileContent = buffer.toString("utf8");
      if (fileContent.includes("�")) {
        fileContent = buffer.toString("latin1");
      }

      errorStage = "parse";
      let ofxData: any;
      try {
        ofxData = await Ofx.parse(fileContent);
      } catch (parseError: any) {
        throw new Error(`OFX inválido ou corrompido: ${parseError?.message || parseError}`);
      }

      const toArray = <T,>(value: T | T[] | undefined): T[] => {
        if (!value) return [];
        return Array.isArray(value) ? value : [value];
      };

      const accountsArray = toArray(ofxData?.OFX?.BANKMSGSRSV1?.STMTTRNRS);
      if (accountsArray.length === 0) {
        throw new Error("Arquivo OFX não contém contas bancárias para importação");
      }

      ingestionLogger.info("OFX parseado", {
        event: "pj.ofx.import.parsed",
        context: {
          accounts: accountsArray.length,
        },
      });

      const parseDate = (value?: string): string | undefined => {
        if (!value) return undefined;
        const trimmed = value.trim();
        if (trimmed.length < 8) {
          throw new Error(`Data OFX inválida: ${value}`);
        }
        return formatBR(trimmed.substring(0, 8));
      };

      const round2 = (value: number) => Math.round(value * 100) / 100;

      const existingImports = new Map<string, OFXImport | null>();
      const newTransactions: BankTransaction[] = [];
      const newTransactionsByAccount = new Map<string, BankTransaction[]>();
      const pendingTransactionsByAccount = new Map<string, BankTransaction[]>();
      const existingTransactionsByAccount = new Map<string, BankTransaction[]>();
      const warningsByAccount = new Map<string, string[]>();
      const bankNameByAccount = new Map<string, string>();
      const accountTransactionTotals = new Map<string, number>();
      warnings = [];
      const addWarning = (accountId: string, message: string) => {
        warnings.push(message);
        const perAccount = warningsByAccount.get(accountId) ?? [];
        perAccount.push(message);
        warningsByAccount.set(accountId, perAccount);
      };
      const accountSummaries: {
        accountId: string;
        currency?: string;
        startDate?: string;
        endDate?: string;
        openingBalance?: number;
        ledgerClosingBalance?: number;
        computedClosingBalance?: number;
        totalCredits: number;
        totalDebits: number;
        net: number;
        divergence?: number;
      }[] = [];
      let totalTransactionsInFile = 0;
      let dedupedCount = 0;

      errorStage = "processing";

      const signonFi = ofxData?.OFX?.SIGNONMSGSRSV1?.SONRS?.FI;
      const fallbackBankNameRaw = signonFi?.ORG || signonFi?.FID;

      for (const account of accountsArray) {
        const parsedAccount = ofxStatementSchema.parse(account);
        const statement = parsedAccount.STMTRS;

        const accountId =
          statement.BANKACCTFROM?.ACCTID ||
          statement.BANKACCTFROM?.BANKID ||
          `conta_${accountSummaries.length + 1}`;

        const maskedBankName = extractMaskedBankNameFromStatement(statement, fallbackBankNameRaw);
        const accountLogger = ingestionLogger.child({
          bankAccountId: accountId,
          bankName: maskedBankName,
        });

        bankNameByAccount.set(accountId, maskedBankName);

        accountLogger.info("Iniciando processamento de extrato bancário", {
          event: "pj.ofx.import.account.start",
          context: {
            clientId: resolvedClientId,
            statementIndex: accountSummaries.length + 1,
          },
        });

        if (!activeTimers.has(accountId)) {
          activeTimers.set(
            accountId,
            startOfxIngestionTimer(resolvedClientId, accountId, maskedBankName)
          );
        }

        const existingImport = await storage.getOFXImport(resolvedClientId, accountId, fileHash);
        existingImports.set(accountId, existingImport);

        const txArray = toArray(statement.BANKTRANLIST?.STMTTRN);
        if (txArray.length === 0) {
          accountTransactionTotals.set(accountId, 0);
          addWarning(accountId, `Conta ${accountId} sem transações no período informado.`);
          accountLogger.warn("Conta sem transações no extrato OFX", {
            event: "pj.ofx.import.account.empty",
            context: {
              clientId,
              bankAccountId: accountId,
              bankName: maskedBankName,
            },
          });
          accountSummaries.push({
            accountId,
            currency: statement.CURDEF,
            startDate: parseDate(statement.BANKTRANLIST?.DTSTART),
            endDate: parseDate(statement.BANKTRANLIST?.DTEND),
            openingBalance: undefined,
            ledgerClosingBalance: undefined,
            computedClosingBalance: undefined,
            totalCredits: 0,
            totalDebits: 0,
            net: 0,
          });
          continue;
        }

        accountTransactionTotals.set(accountId, txArray.length);
        const startDate = parseDate(statement.BANKTRANLIST?.DTSTART);
        const endDate = parseDate(statement.BANKTRANLIST?.DTEND);

        let totalCredits = 0;
        let totalDebits = 0;
        let net = 0;

        const existingBankTxs = existingTransactionsByAccount.get(accountId) ??
          (await storage.getBankTransactions(resolvedClientId, accountId));
        existingTransactionsByAccount.set(accountId, existingBankTxs);
        const pendingForAccount = pendingTransactionsByAccount.get(accountId) ?? [];

        for (const rawTx of txArray) {
          const parsedTx = ofxTransactionSchema.parse(rawTx);
          const date = parseDate(parsedTx.DTPOSTED)!;
          const { amount, adjusted } = normalizeOfxAmount(parsedTx.TRNAMT, parsedTx.TRNTYPE);
          const desc = parsedTx.MEMO || parsedTx.NAME || "Sem descrição";
          const fitid = parsedTx.FITID || parsedTx.UNIQUEID || parsedTx.REFNUM || parsedTx.CHECKNUM;

          totalTransactionsInFile += 1;
          if (amount > 0) {
            totalCredits = round2(totalCredits + amount);
          } else if (amount < 0) {
            totalDebits = round2(totalDebits + Math.abs(amount));
          }
          net = round2(net + amount);

          if (adjusted && parsedTx.TRNTYPE) {
            addWarning(
              accountId,
              `Sinal ajustado automaticamente: transação ${fitid || desc} reinterpretada como ${parsedTx.TRNTYPE}.`
            );
          }

          const isDuplicate = isDuplicateTransaction(
            existingBankTxs,
            pendingForAccount,
            {
              amount,
              desc,
              date,
              fitid,
            }
          );

          if (isDuplicate) {
            dedupedCount += 1;
            continue;
          }

          const bankTx: BankTransaction = {
            bankTxId: crypto.randomUUID(),
            date,
            desc,
            amount,
            bankAccountId: accountId,
            accountId,
            fitid,
            sourceHash: fileHash,
            linkedLegs: [],
            reconciled: false,
          };

          newTransactions.push(bankTx);
          pendingForAccount.push(bankTx);
          pendingTransactionsByAccount.set(accountId, pendingForAccount);
          const perAccountNew = newTransactionsByAccount.get(accountId) ?? [];
          perAccountNew.push(bankTx);
          newTransactionsByAccount.set(accountId, perAccountNew);
        }

        const ledgerRaw = statement.LEDGERBAL?.BALAMT;
        let ledgerClosingBalance: number | undefined;
        if (ledgerRaw !== undefined) {
          const parsedLedger = Number.parseFloat(String(ledgerRaw).replace(",", "."));
          if (Number.isNaN(parsedLedger)) {
            addWarning(accountId, `Saldo final inválido informado para a conta ${accountId}.`);
          } else {
            ledgerClosingBalance = round2(parsedLedger);
          }
        } else {
          addWarning(accountId, `Saldo final (LEDGERBAL) ausente na conta ${accountId}.`);
        }

        let openingBalance: number | undefined;
        const openingRaw = (statement.BANKTRANLIST as any)?.BALAMT;
        if (openingRaw !== undefined) {
          const parsedOpening = Number.parseFloat(String(openingRaw).replace(",", "."));
          if (!Number.isNaN(parsedOpening)) {
            openingBalance = round2(parsedOpening);
          }
        }

        if (openingBalance === undefined && ledgerClosingBalance !== undefined) {
          openingBalance = round2(ledgerClosingBalance - net);
        }

        const computedClosingBalance =
          openingBalance !== undefined ? round2(openingBalance + net) : undefined;

        let divergence: number | undefined;
        if (ledgerClosingBalance !== undefined && computedClosingBalance !== undefined) {
          divergence = round2(computedClosingBalance - ledgerClosingBalance);
          if (Math.abs(divergence) > 0.01) {
            addWarning(
              accountId,
              `Divergência de R$ ${Math.abs(divergence).toFixed(2)} no saldo final da conta ${accountId}.`
            );
          }
        }

        accountSummaries.push({
          accountId,
          currency: statement.CURDEF,
          startDate,
          endDate,
          openingBalance,
          ledgerClosingBalance,
          computedClosingBalance,
          totalCredits: round2(totalCredits),
          totalDebits: round2(totalDebits),
          net,
          divergence,
        });

        const perAccountNew = newTransactionsByAccount.get(accountId) ?? [];
        const perAccountWarnings = warningsByAccount.get(accountId) ?? [];
        accountLogger.info("Extrato bancário processado", {
          event: "pj.ofx.import.account.summary",
          context: {
            clientId: resolvedClientId,
            bankAccountId: accountId,
            bankName: maskedBankName,
            transactionsInStatement: txArray.length,
            newTransactions: perAccountNew.length,
            deduped: txArray.length - perAccountNew.length,
            warnings: perAccountWarnings.length,
            startDate,
            endDate,
            openingBalance,
            ledgerClosingBalance,
            computedClosingBalance,
            divergence,
          },
        });
      }

      const duplicateAccounts = Array.from(existingImports.values()).filter(Boolean).length;
      const alreadyImported =
        accountSummaries.length > 0 && duplicateAccounts === accountSummaries.length;

      if (totalTransactionsInFile === 0) {
        throw new Error("Nenhuma transação encontrada no arquivo OFX enviado.");
      }

      ingestionLogger.info("Processamento OFX concluído", {
        event: "pj.ofx.import.summary",
        context: {
          totalTransactionsInFile,
          newTransactions: newTransactions.length,
          deduped: dedupedCount,
          warnings: warnings.length,
        },
      });

      errorStage = "categorize";
      const rules = await storage.getCategorizationRules(resolvedClientId);
      const categorizedCount = applyCategorizationRules(newTransactions, rules);

      if (newTransactions.length > 0) {
        await storage.addBankTransactions(resolvedClientId, newTransactions);
      }

      errorStage = "persist";
      const importedAt = new Date().toISOString();
      await Promise.all(
        accountSummaries.map(async summary => {
          const perAccountWarnings = warningsByAccount.get(summary.accountId) ?? [];
          const accountTransactions = accountTransactionTotals.get(summary.accountId) ?? 0;
          await storage.addOFXImport({
            fileHash,
            clientId: resolvedClientId,
            bankAccountId: summary.accountId,
            importedAt,
            transactionCount: accountTransactions,
            statementStart: summary.startDate,
            statementEnd: summary.endDate,
            reconciliation: {
              accounts: [summary],
              warnings: perAccountWarnings,
            },
          });
        })
      );

      ingestionLogger.info("Reconciliação OFX consolidada", {
        event: "pj.ofx.import.reconciliation",
        context: {
          accounts: accountSummaries.length,
          warnings: warnings.length,
        },
      });

      errorStage = "audit";
      const accountAuditMetadata = buildAccountAuditMetadata(
        accountSummaries.map(summary => summary.accountId)
      );
      const singleAccount = accountAuditMetadata.length === 1 ? accountAuditMetadata[0] : null;

      await recordAuditEvent({
        user: req.authUser!,
        eventType: "pj.ofx.import",
        targetType: "bank-transactions",
        metadata: {
          clientId: resolvedClientId,
          bankAccountId: singleAccount ? singleAccount.bankAccountId : null,
          accountNumberMask: singleAccount ? singleAccount.accountNumberMask : null,
          accountIdentifiers: accountAuditMetadata,
          accounts: accountSummaries.length,
          imported: newTransactions.length,
          categorized: categorizedCount,
          duplicateFile: alreadyImported,
          duplicateAccounts,
          warnings: warnings.length,
          deduped: dedupedCount,
        },
      });

      errorStage = "response";
      activeTimers.forEach(timer => {
        recordOfxIngestionDuration(timer, "success");
      });
      activeTimers.clear();

      const durationMs =
        ingestionStartedAt !== null
          ? Number(process.hrtime.bigint() - ingestionStartedAt) / 1_000_000
          : 0;
      accountSummaries.forEach(summary => {
        const perAccountWarnings = warningsByAccount.get(summary.accountId) ?? [];
        recordOfxImportOutcome({
          clientId: resolvedClientId,
          importId,
          bankAccountId: summary.accountId,
          bankName: bankNameByAccount.get(summary.accountId),
          success: true,
          durationMs,
          warnings: perAccountWarnings.length,
        });
      });

      ingestionLogger.info("Importação OFX concluída", {
        event: "pj.ofx.import.success",
        context: {
          imported: newTransactions.length,
          autoCategorized: categorizedCount,
          deduped: dedupedCount,
          warnings: warnings.length,
          alreadyImported,
        },
      });

      return res.json({
        success: true,
        imported: newTransactions.length,
        total: totalTransactionsInFile,
        deduped: dedupedCount,
        autoCategorized: categorizedCount,
        alreadyImported,
        reconciliation: {
          accounts: accountSummaries,
          warnings,
        },
      });
    } catch (error: any) {
      if (currentClientId) {
        const safeClientId = currentClientId;
        const hrNow = process.hrtime.bigint();
        const timersSnapshot = Array.from(activeTimers.values());
        if (activeTimers.size > 0) {
          timersSnapshot.forEach(timer => {
            incrementOfxError(timer.clientId, timer.bankAccountId, errorStage, timer.bankName);
            recordOfxIngestionDuration(timer, "error");
          });
          activeTimers.clear();
        } else {
          incrementOfxError(safeClientId, UNKNOWN_BANK_LABEL, errorStage);
          const elapsedSeconds =
            ingestionStartedAt !== null
              ? Number(hrNow - ingestionStartedAt) / 1_000_000_000
              : 0;
          ofxIngestionDuration.observe(
            {
              clientId: safeClientId,
              bankAccountId: UNKNOWN_BANK_LABEL,
              bankName: UNKNOWN_BANK_LABEL,
              status: "error",
            },
            elapsedSeconds
          );
        }

        const durationMs =
          ingestionStartedAt !== null ? Number(hrNow - ingestionStartedAt) / 1_000_000 : 0;

        if (timersSnapshot.length > 0) {
          timersSnapshot.forEach(timer => {
            recordOfxImportOutcome({
              clientId: safeClientId,
              importId,
              bankAccountId: timer.bankAccountId,
              bankName: timer.bankName,
              success: false,
              durationMs,
              warnings: warnings.length,
              error,
            });
          });
        } else {
          recordOfxImportOutcome({
            clientId: safeClientId,
            importId,
            bankAccountId: UNKNOWN_BANK_LABEL,
            bankName: UNKNOWN_BANK_LABEL,
            success: false,
            durationMs,
            warnings: warnings.length,
            error,
          });
      }
      }

      ingestionLogger.error("Erro ao importar OFX PJ", {
        event: "pj.ofx.import.error",
        context: { stage: errorStage },
      }, error);
      return res.status(500).json({ error: error.message || "Erro ao importar OFX" });
    }
  });
  /**
   * POST /api/pj/reconciliation/suggest
   * Sugerir matches automáticos entre transações bancárias e parcelas de vendas
   */
  app.post("/api/pj/reconciliation/suggest", scopeRequired("PJ"), async (req, res) => {
    try {
      const schema = z.object({
        clientId: z.string(),
        saleLegId: z.string(),
      });
      
      const { clientId, saleLegId } = schema.parse(req.body);
      
      // Buscar leg
      const legs = await storage.getSaleLegs(clientId);
      const leg = legs.find(l => l.saleLegId === saleLegId);
      
      if (!leg) {
        return res.status(404).json({ error: "Leg de venda não encontrado" });
      }
      
      // Buscar parcelas pendentes
      const pendingParcels = leg.settlementPlan.filter(p => !p.receivedTxId);
      
      if (pendingParcels.length === 0) {
        return res.json({ suggestions: [] });
      }
      
      // Buscar transações bancárias não conciliadas
      const bankTxs = await storage.getBankTransactions(clientId);
      const unreconciled = bankTxs.filter(t => !t.reconciled && t.amount > 0);
      
      // Sugestões
      const suggestions: any[] = [];
      
      for (const parcel of pendingParcels) {
        // Match por valor exato e data próxima (±3 dias)
        const dueISO = toISOFromBR(parcel.due);
        
        for (const tx of unreconciled) {
          const txISO = toISOFromBR(tx.date);
          const daysDiff = Math.abs(
            (new Date(txISO).getTime() - new Date(dueISO).getTime()) / (1000 * 60 * 60 * 24)
          );
          
          // Match se valor igual e data dentro de 3 dias
          if (Math.abs(tx.amount - parcel.expected) < 0.01 && daysDiff <= 3) {
            suggestions.push({
              parcelN: parcel.n,
              bankTxId: tx.bankTxId,
              date: tx.date,
              amount: tx.amount,
              desc: tx.desc,
              score: 100 - (daysDiff * 10), // Score diminui conforme distância da data
              matchReason: `Valor: R$ ${parcel.expected.toFixed(2)} | Data: ${parcel.due} (diferença: ${daysDiff.toFixed(0)} dias)`,
            });
          }
        }
      }
      
      // Ordenar por score
      suggestions.sort((a, b) => b.score - a.score);
      
      res.json({ suggestions });
    } catch (error: any) {
      getLogger(req).error("Erro ao sugerir conciliação PJ", {
        event: "pj.reconciliation.suggest",
        context: { clientId: req.body?.clientId },
      }, error);
      res.status(400).json({ error: error.message || "Erro ao sugerir conciliação" });
    }
  });
  
  /**
   * POST /api/pj/reconciliation/confirm
   * Confirmar conciliação manual entre transação bancária e parcela de venda
   */
  app.post("/api/pj/reconciliation/confirm", scopeRequired("PJ"), async (req, res) => {
    try {
      const schema = z.object({
        clientId: z.string(),
        saleLegId: z.string(),
        matches: z.array(z.object({
          parcelN: z.number(),
          bankTxId: z.string(),
        })),
        note: z.string().optional(),
      });
      
      const { clientId, saleLegId, matches, note } = schema.parse(req.body);
      
      // Buscar leg
      const legs = await storage.getSaleLegs(clientId);
      const leg = legs.find(l => l.saleLegId === saleLegId);
      
      if (!leg) {
        return res.status(404).json({ error: "Leg de venda não encontrado" });
      }
      
      // Buscar transações bancárias
      const bankTxs = await storage.getBankTransactions(clientId);
      
      // Atualizar parcelas e transações
      const matchedAccountIds = new Set<string>();
      for (const match of matches) {
        const parcel = leg.settlementPlan.find(p => p.n === match.parcelN);
        const bankTx = bankTxs.find(t => t.bankTxId === match.bankTxId);

        if (!parcel || !bankTx) {
          return res.status(400).json({ error: `Match inválido: parcela ${match.parcelN}` });
        }

        // Verificar se transação já está conciliada
        if (bankTx.reconciled) {
          return res.status(400).json({
            error: `Transação ${bankTx.bankTxId} já está conciliada`
          });
        }

        if (bankTx.bankAccountId) {
          matchedAccountIds.add(bankTx.bankAccountId);
        }

        // Atualizar parcela
        parcel.receivedTxId = bankTx.bankTxId;
        parcel.receivedAt = bankTx.date;
        
        // Atualizar transação bancária
        bankTx.reconciled = true;
        bankTx.linkedLegs.push({
          saleLegId,
          nParcela: match.parcelN,
        });
      }
      
      // Atualizar estado de reconciliação do leg
      const totalParcels = leg.settlementPlan.length;
      const reconciledParcels = leg.settlementPlan.filter(p => p.receivedTxId).length;
      
      if (reconciledParcels === totalParcels) {
        leg.reconciliation.state = "conciliado";
      } else if (reconciledParcels > 0) {
        leg.reconciliation.state = "parcial";
      }
      
      if (note) {
        leg.reconciliation.notes = note;
      }
      
      // Salvar
      await storage.setSaleLegs(clientId, legs);
      await storage.setBankTransactions(clientId, bankTxs);

      const reconciliationAccountMetadata = buildAccountAuditMetadata(matchedAccountIds);
      const reconciliationSingleAccount =
        reconciliationAccountMetadata.length === 1 ? reconciliationAccountMetadata[0] : null;

      await recordAuditEvent({
        user: req.authUser!,
        eventType: "pj.sale.reconcile",
        targetType: "sale-leg",
        targetId: saleLegId,
        metadata: {
          clientId,
          bankAccountId: reconciliationSingleAccount ? reconciliationSingleAccount.bankAccountId : null,
          accountNumberMask: reconciliationSingleAccount ? reconciliationSingleAccount.accountNumberMask : null,
          accountIdentifiers: reconciliationAccountMetadata,
          matches: matches.length,
          reconciledParcels,
          totalParcels,
        },
      });

      res.json({
        success: true,
        leg,
        reconciliationState: leg.reconciliation.state,
        reconciledParcels,
        totalParcels,
      });
    } catch (error: any) {
      getLogger(req).error("Erro ao confirmar conciliação PJ", {
        event: "pj.reconciliation.confirm",
        context: { clientId: req.body?.clientId },
      }, error);
      res.status(400).json({ error: error.message || "Erro ao confirmar conciliação" });
    }
  });
  
  // ===== CATEGORIZAÇÃO INTELIGENTE PJ =====
  
  /**
   * GET /api/pj/categorization/rules
   * Listar todas as regras de categorização
   */
  app.get("/api/pj/categorization/rules", scopeRequired("PJ"), async (req, res) => {
    try {
      const clientId = req.query.clientId as string;
      if (!clientId) {
        return res.status(400).json({ error: "clientId é obrigatório" });
      }
      
      const rules = await storage.getCategorizationRules(clientId);
      
      res.json({ rules });
    } catch (error: any) {
      getLogger(req).error("Erro ao listar regras PJ", {
        event: "pj.rules.list",
        context: { clientId: req.query?.clientId },
      }, error);
      res.status(500).json({ error: error.message || "Erro ao listar regras" });
    }
  });
  
  /**
   * POST /api/pj/categorization/rules
   * Salvar regra de categorização
   */
  app.post("/api/pj/categorization/rules", scopeRequired("PJ"), async (req, res) => {
    try {
      const schema = z.object({
        clientId: z.string(),
        pattern: z.string(),
        matchType: z.enum(["exact", "contains", "startsWith"]),
        dfcCategory: z.string(),
        dfcItem: z.string(),
        applyRetroactive: z.boolean().default(true),
      });
      
      const data = schema.parse(req.body);
      
      // Criar regra
      const createdAt = new Date().toISOString();
      const rule: CategorizationRule = {
        ruleId: uuidv4(),
        pattern: data.pattern,
        matchType: data.matchType,
        action: {
          type: "categorize_as_expense",
          category: data.dfcCategory as CategorizationRule["action"]["category"],
          subcategory: data.dfcItem,
          autoConfirm: false,
        },
        confidence: 100,
        learnedFrom: {
          bankTxId: "manual-rule",
          date: formatBR(createdAt.split("T")[0]),
        },
        appliedCount: 0,
        enabled: true,
        dfcCategory: data.dfcCategory,
        dfcItem: data.dfcItem,
        createdAt,
      };
      
      // Salvar regra
      const rules = await storage.getCategorizationRules(data.clientId);
      await storage.setCategorizationRules(data.clientId, [...rules, rule]);
      
      // Aplicação retroativa (se solicitado)
      let retroactiveCount = 0;
      const affectedAccounts = new Set<string>();
      if (data.applyRetroactive) {
        const bankTxs = await storage.getBankTransactions(data.clientId);

        for (const tx of bankTxs) {
          if (matchesPattern(tx.desc, rule.pattern, rule.matchType)) {
            tx.dfcCategory = rule.dfcCategory;
            tx.dfcItem = rule.dfcItem;
            tx.categorizedBy = "rule";
            tx.categorizedRuleId = rule.ruleId;
            retroactiveCount++;
            if (tx.bankAccountId) {
              affectedAccounts.add(tx.bankAccountId);
            }
          }
        }

        await storage.setBankTransactions(data.clientId, bankTxs);
      }

      const retroactiveAccountMetadata = buildAccountAuditMetadata(affectedAccounts);
      const retroactiveSingleAccount =
        retroactiveAccountMetadata.length === 1 ? retroactiveAccountMetadata[0] : null;

      await recordAuditEvent({
        user: req.authUser!,
        eventType: "pj.transaction.update",
        targetType: "categorization-rule",
        targetId: rule.ruleId,
        metadata: {
          clientId: data.clientId,
          matchType: rule.matchType,
          bankAccountId: retroactiveSingleAccount ? retroactiveSingleAccount.bankAccountId : null,
          accountNumberMask: retroactiveSingleAccount ? retroactiveSingleAccount.accountNumberMask : null,
          accountIdentifiers: retroactiveAccountMetadata,
          retroactiveCount,
        },
      });

      res.json({
        success: true,
        rule,
        retroactiveCount,
      });
    } catch (error: any) {
      getLogger(req).error("Erro ao salvar regra PJ", {
        event: "pj.rules.save",
        context: { clientId: req.body?.clientId },
      }, error);
      res.status(400).json({ error: error.message || "Erro ao salvar regra" });
    }
  });
  
  /**
   * POST /api/pj/categorization/apply
   * Aplicar categorização manual (e aprender para criar regra)
   */
  app.post("/api/pj/categorization/apply", scopeRequired("PJ"), async (req, res) => {
    try {
      const schema = z.object({
        clientId: z.string(),
        bankTxId: z.string(),
        dfcCategory: z.string(),
        dfcItem: z.string(),
        learnPattern: z.boolean().default(true),
        matchType: z.enum(["exact", "contains", "startsWith"]).default("contains"),
      });
      
      const data = schema.parse(req.body);
      
      // Buscar transação
      const bankTxs = await storage.getBankTransactions(data.clientId);
      const tx = bankTxs.find(t => t.bankTxId === data.bankTxId);
      
      if (!tx) {
        return res.status(404).json({ error: "Transação bancária não encontrada" });
      }
      
      const affectedAccounts = new Set<string>();
      if (tx.bankAccountId) {
        affectedAccounts.add(tx.bankAccountId);
      }

      // Aplicar categorização manual
      tx.dfcCategory = data.dfcCategory;
      tx.dfcItem = data.dfcItem;
      tx.categorizedBy = "manual";
      
      await storage.setBankTransactions(data.clientId, bankTxs);
      
      // Aprender padrão (se solicitado)
      let rule: CategorizationRule | null = null;
      let prospectiveCount = 0;
      
      if (data.learnPattern) {
        // Extrair padrão do desc
        const pattern = extractPattern(tx.desc, data.matchType);
        
        // Criar nova regra
        const createdAt = new Date().toISOString();
        const newRule: CategorizationRule = {
          ruleId: uuidv4(),
          pattern,
          matchType: data.matchType,
          action: {
            type: "categorize_as_expense",
            category: data.dfcCategory as CategorizationRule["action"]["category"],
            subcategory: data.dfcItem,
            autoConfirm: false,
          },
          confidence: 90,
          learnedFrom: {
            bankTxId: tx.bankTxId,
            date: tx.date,
          },
          appliedCount: 1,
          enabled: true,
          dfcCategory: data.dfcCategory,
          dfcItem: data.dfcItem,
          createdAt,
        };

        rule = newRule;

        // Salvar regra
        const rules = await storage.getCategorizationRules(data.clientId);
        await storage.setCategorizationRules(data.clientId, [...rules, newRule]);

        // Aplicação prospectiva (categorizar outras transações não categorizadas)
        for (const otherTx of bankTxs) {
          if (
            otherTx.bankTxId !== tx.bankTxId &&
            !otherTx.dfcCategory &&
            matchesPattern(otherTx.desc, pattern, data.matchType)
          ) {
            otherTx.dfcCategory = data.dfcCategory;
            otherTx.dfcItem = data.dfcItem;
            otherTx.categorizedBy = "rule";
            otherTx.categorizedRuleId = newRule.ruleId;
            prospectiveCount++;
            if (otherTx.bankAccountId) {
              affectedAccounts.add(otherTx.bankAccountId);
            }
          }
        }

        await storage.setBankTransactions(data.clientId, bankTxs);
      }

      const manualAccountMetadata = buildAccountAuditMetadata(affectedAccounts);
      const manualSingleAccount = manualAccountMetadata.length === 1 ? manualAccountMetadata[0] : null;

      await recordAuditEvent({
        user: req.authUser!,
        eventType: "pj.transaction.update",
        targetType: "bank-transaction",
        targetId: tx.bankTxId,
        metadata: {
          clientId: data.clientId,
          bankAccountId: manualSingleAccount ? manualSingleAccount.bankAccountId : null,
          accountNumberMask: manualSingleAccount ? manualSingleAccount.accountNumberMask : null,
          accountIdentifiers: manualAccountMetadata,
          category: data.dfcCategory,
          learnPattern: data.learnPattern,
          prospectiveCount,
          ruleId: rule?.ruleId,
        },
      });

      res.json({
        success: true,
        transaction: tx,
        rule,
        prospectiveCount,
      });
    } catch (error: any) {
      getLogger(req).error("Erro ao aplicar categorização PJ", {
        event: "pj.rules.apply",
        context: { clientId: req.body?.clientId },
      }, error);
      res.status(400).json({ error: error.message || "Erro ao aplicar categorização" });
    }
  });
  
  // ===== DASHBOARD BACKEND PJ =====
  
  /**
   * GET /api/pj/dashboard/monthly-insights
   * Retorna KPIs mensais consolidados com base nas vendas e transações importadas
   */
  app.get(
    "/api/pj/dashboard/monthly-insights",
    scopeRequired("PJ"),
    ensureBankAccountAccess,
    async (req, res) => {
      try {
        const clientId = req.query.clientId as string;
        const month = (req.query.month as string) || undefined;

        if (!clientId) {
          return res.status(400).json({ error: "clientId é obrigatório" });
        }

        const bankAccount = req.bankAccountContext;
        if (!bankAccount) {
          return res.status(500).json({ error: "Contexto da conta bancária não carregado" });
        }

        const [bankTxs, sales] = await Promise.all([
          storage.getBankTransactions(clientId, bankAccount.id),
          storage.getSales(clientId),
        ]);

        const insights = buildMonthlyInsights(bankTxs, sales, month);

        res.json(insights);
      } catch (error: any) {
        getLogger(req).error("Erro ao buscar monthly-insights PJ", {
          event: "pj.dashboard.monthly-insights",
          context: { clientId: req.query?.clientId },
        }, error);
        res.status(500).json({ error: error.message || "Erro ao buscar monthly-insights" });
      }
    }
  );

  app.get(
    "/api/pj/summary",
    scopeRequired("PJ"),
    ensureBankAccountAccess,
    async (req, res) => {
      try {
        const clientId = req.query.clientId as string;
        const bankAccount = req.bankAccountContext;

        if (!clientId) {
          return res.status(400).json({ error: "clientId é obrigatório" });
        }

        if (!bankAccount) {
          return res
            .status(500)
            .json({ error: "Contexto da conta bancária não carregado" });
        }

        const requestedFrom =
          typeof req.query.from === "string" ? req.query.from : undefined;
        const requestedTo =
          typeof req.query.to === "string" ? req.query.to : undefined;

        let normalizedFrom: string | undefined;
        let normalizedTo: string | undefined;

        try {
          normalizedFrom = requestedFrom ? formatBR(requestedFrom) : undefined;
          normalizedTo = requestedTo ? formatBR(requestedTo) : undefined;
        } catch (error) {
          return res.status(400).json({
            error: "Datas inválidas. Utilize o formato DD/MM/AAAA",
          });
        }

        const transactions = await storage.getBankTransactions(
          clientId,
          bankAccount.id
        );

        const isoDates = transactions
          .filter(tx => tx.date)
          .map(tx => toISOFromBR(tx.date))
          .sort();

        let rangeStart = normalizedFrom;
        let rangeEnd = normalizedTo;

        if (!rangeStart && isoDates.length > 0) {
          rangeStart = formatBR(isoDates[0]);
        }

        if (!rangeEnd && isoDates.length > 0) {
          rangeEnd = formatBR(isoDates[isoDates.length - 1]);
        }

        if (rangeStart && rangeEnd) {
          const startISO = toISOFromBR(rangeStart);
          const endISO = toISOFromBR(rangeEnd);

          if (new Date(startISO) > new Date(endISO)) {
            return res.status(400).json({
              error: "Período inválido: data inicial maior que final",
            });
          }
        }

        const filteredTransactions =
          rangeStart && rangeEnd
            ? transactions.filter(tx =>
                isBetweenDates(tx.date, rangeStart!, rangeEnd!)
              )
            : transactions;

        const inflowTransactions = filteredTransactions.filter(
          tx => tx.amount > 0
        );
        const outflowTransactions = filteredTransactions.filter(
          tx => tx.amount < 0
        );

        const totalIn = inflowTransactions.reduce(
          (sum, tx) => sum + tx.amount,
          0
        );
        const totalOut = outflowTransactions.reduce(
          (sum, tx) => sum + Math.abs(tx.amount),
          0
        );
        const balance = totalIn - totalOut;

        const inflowCount = inflowTransactions.length;
        const outflowCount = outflowTransactions.length;
        const largestIn = inflowTransactions.length
          ? Math.max(...inflowTransactions.map(tx => tx.amount))
          : 0;
        const largestOut = outflowTransactions.length
          ? Math.max(...outflowTransactions.map(tx => Math.abs(tx.amount)))
          : 0;

        const coverageDays = (() => {
          if (!rangeStart || !rangeEnd) {
            return 0;
          }
          const start = new Date(toISOFromBR(rangeStart));
          const end = new Date(toISOFromBR(rangeEnd));
          const diffMs = end.getTime() - start.getTime();
          return diffMs >= 0 ? Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1 : 0;
        })();

        const averageDailyNetFlow =
          coverageDays > 0 ? balance / coverageDays : 0;
        const averageTicketIn =
          inflowCount > 0 ? totalIn / inflowCount : 0;
        const averageTicketOut =
          outflowCount > 0 ? totalOut / outflowCount : 0;
        const cashConversionRatio = totalIn > 0 ? balance / totalIn : 0;

        const saleLegs = await storage.getSaleLegs(clientId);
        const relevantParcels = saleLegs.flatMap(leg =>
          leg.settlementPlan.filter(parcel => {
            if (parcel.receivedTxId) {
              return false;
            }

            if (!rangeStart || !rangeEnd) {
              return true;
            }

            return isBetweenDates(parcel.due, rangeStart, rangeEnd);
          })
        );

        const receivableAmount = relevantParcels.reduce(
          (sum, parcel) => sum + parcel.expected,
          0
        );
        const receivableCount = relevantParcels.length;

        const now = new Date();
        const overdueParcels = relevantParcels.filter(parcel => {
          try {
            const dueISO = toISOFromBR(parcel.due);
            return new Date(dueISO) < now;
          } catch (error) {
            return false;
          }
        });

        const overdueReceivableAmount = overdueParcels.reduce(
          (sum, parcel) => sum + parcel.expected,
          0
        );

        const dailyNetFlows = (() => {
          const aggregation = new Map<string, number>();

          for (const tx of filteredTransactions) {
            const key = formatBR(tx.date);
            const existing = aggregation.get(key) ?? 0;
            aggregation.set(key, existing + tx.amount);
          }

          return Array.from(aggregation.entries())
            .map(([date, value]) => ({
              date,
              net: value,
            }))
            .sort((a, b) => {
              const aTime = new Date(toISOFromBR(a.date)).getTime();
              const bTime = new Date(toISOFromBR(b.date)).getTime();
              return aTime - bTime;
            });
        })();

        const projectedBalance = balance + receivableAmount;

        const responsePayload = {
          clientId,
          bankAccountId: bankAccount.id,
          from: rangeStart ?? null,
          to: rangeEnd ?? null,
          totals: {
            totalIn,
            totalOut,
            balance,
          },
          kpis: {
            inflowCount,
            outflowCount,
            averageTicketIn,
            averageTicketOut,
            largestIn,
            largestOut,
            averageDailyNetFlow,
            cashConversionRatio,
            receivableAmount,
            receivableCount,
            overdueReceivableAmount,
            overdueReceivableCount: overdueParcels.length,
            projectedBalance,
          },
          series: {
            dailyNetFlows,
          },
          metadata: {
            transactionCount: filteredTransactions.length,
            coverageDays,
            generatedAt: new Date().toISOString(),
          },
        };

        const etag = crypto
          .createHash("sha1")
          .update(JSON.stringify(responsePayload))
          .digest("hex");

        res.setHeader("Cache-Control", "private, max-age=30");
        res.setHeader("ETag", etag);

        if (req.headers["if-none-match"] === etag) {
          return res.status(304).end();
        }

        return res.json(responsePayload);
      } catch (error: any) {
        getLogger(req).error(
          "Erro ao buscar summary PJ",
          {
            event: "pj.summary",
            context: { clientId: req.query?.clientId },
          },
          error
        );
        return res
          .status(500)
          .json({ error: error?.message || "Erro ao buscar summary" });
      }
    }
  );

  /**
   * GET /api/pj/dashboard/costs-breakdown
   * Retorna a visão consolidada do DFC e custos por categoria
   */
  app.get(
    "/api/pj/dashboard/costs-breakdown",
    scopeRequired("PJ"),
    ensureBankAccountAccess,
    async (req, res) => {
      try {
        const clientId = req.query.clientId as string;
        const month = (req.query.month as string) || undefined;

        if (!clientId) {
          return res.status(400).json({ error: "clientId é obrigatório" });
        }

        const bankAccount = req.bankAccountContext;
        if (!bankAccount) {
          return res.status(500).json({ error: "Contexto da conta bancária não carregado" });
        }

        const [bankTxs, sales] = await Promise.all([
          storage.getBankTransactions(clientId, bankAccount.id),
          storage.getSales(clientId),
        ]);

        const breakdown = buildCostBreakdown(bankTxs, sales, month);

        res.json(breakdown);
      } catch (error: any) {
        getLogger(req).error("Erro ao buscar costs-breakdown PJ", {
          event: "pj.dashboard.costs-breakdown",
          context: { clientId: req.query?.clientId },
        }, error);
        res.status(500).json({ error: error.message || "Erro ao buscar costs-breakdown" });
      }
    }
  );

  /**
   * GET /api/pj/dashboard/summary
   * KPIs do mês: receita, despesas, saldo, contas a receber
   */
  app.get(
    "/api/pj/dashboard/summary",
    scopeRequired("PJ"),
    ensureBankAccountAccess,
    async (req, res) => {
      try {
        const clientId = req.query.clientId as string;
        const month = req.query.month as string; // YYYY-MM

        if (!clientId || !month) {
          return res.status(400).json({ error: "clientId e month são obrigatórios" });
        }

        const bankAccount = req.bankAccountContext;
        if (!bankAccount) {
          return res.status(500).json({ error: "Contexto da conta bancária não carregado" });
        }

        const [year, monthNum] = month.split("-");
        const startDate = `01/${monthNum}/${year}`;
        const lastDay = new Date(parseInt(year), parseInt(monthNum), 0).getDate();
        const endDate = `${lastDay}/${monthNum}/${year}`;

        // Buscar transações bancárias do mês
        const bankTxs = await storage.getBankTransactions(clientId, bankAccount.id);
        const txsInMonth = bankTxs.filter(tx => isBetweenDates(tx.date, startDate, endDate));

        const receitas = txsInMonth.filter(tx => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0);
        const despesas = Math.abs(
          txsInMonth.filter(tx => tx.amount < 0).reduce((sum, tx) => sum + tx.amount, 0)
        );
        const saldo = receitas - despesas;

        // Contas a receber (parcelas pendentes)
        const legs = await storage.getSaleLegs(clientId);
        let contasReceber = 0;

        for (const leg of legs) {
          for (const parcel of leg.settlementPlan) {
            if (!parcel.receivedTxId && isBetweenDates(parcel.due, startDate, endDate)) {
              contasReceber += parcel.expected;
            }
          }
        }

        // Calcular lucros e margem
        const lucroBruto = receitas; // Simplificado: assumindo que não temos CMV separado
        const lucroLiquido = saldo; // receitas - despesas
        const margemLiquida = receitas > 0 ? (lucroLiquido / receitas) * 100 : 0;

        res.json({
          month,
          receitas,
          despesas,
          saldo,
          contasReceber,
          lucroBruto,
          lucroLiquido,
          margemLiquida,
        });
      } catch (error: any) {
        getLogger(req).error("Erro ao buscar summary PJ", {
          event: "pj.dashboard.summary",
          context: { clientId: req.query?.clientId },
        }, error);
        res.status(500).json({ error: error.message || "Erro ao buscar summary" });
      }
    }
  );
  
  /**
   * GET /api/pj/dashboard/trends
   * Tendências de receita/despesa do ano vigente
   */
  app.get(
    "/api/pj/dashboard/trends",
    scopeRequired("PJ"),
    ensureBankAccountAccess,
    async (req, res) => {
      try {
        const clientId = req.query.clientId as string;
        const year = req.query.year as string; // Opcional, se não fornecido usa ano atual

        if (!clientId) {
          return res.status(400).json({ error: "clientId é obrigatório" });
        }

        const bankAccount = req.bankAccountContext;
        if (!bankAccount) {
          return res.status(500).json({ error: "Contexto da conta bancária não carregado" });
        }

        const bankTxs = await storage.getBankTransactions(clientId, bankAccount.id);

        // Usar ano fornecido ou ano atual
        const targetYear = year ? parseInt(year) : new Date().getFullYear();
        const trends: any[] = [];

        // Iterar pelos 12 meses do ano
        for (let month = 1; month <= 12; month++) {
          const monthKey = `${targetYear}-${month.toString().padStart(2, "0")}`;

          const txsInMonth = bankTxs.filter(tx => {
            const [day, m, y] = tx.date.split("/");
            const txMonth = `${y}-${m}`;
            return txMonth === monthKey;
          });

          const receitas = txsInMonth.filter(tx => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0);
          const despesas = Math.abs(
            txsInMonth.filter(tx => tx.amount < 0).reduce((sum, tx) => sum + tx.amount, 0)
          );

          trends.push({
            month: monthKey,
            receitas,
            despesas,
          });
        }

        res.json({ trends });
      } catch (error: any) {
        getLogger(req).error("Erro ao buscar trends PJ", {
          event: "pj.dashboard.trends",
          context: { clientId: req.query?.clientId },
        }, error);
        res.status(500).json({ error: error.message || "Erro ao buscar trends" });
      }
    }
  );
  
  /**
   * GET /api/pj/dashboard/top-costs
   * Top 10 custos por categoria DFC
   */
  app.get(
    "/api/pj/dashboard/top-costs",
    scopeRequired("PJ"),
    ensureBankAccountAccess,
    async (req, res) => {
      try {
        const clientId = req.query.clientId as string;
        const month = req.query.month as string; // YYYY-MM

        if (!clientId || !month) {
          return res.status(400).json({ error: "clientId e month são obrigatórios" });
        }

        const bankAccount = req.bankAccountContext;
        if (!bankAccount) {
          return res.status(500).json({ error: "Contexto da conta bancária não carregado" });
        }

        const [year, monthNum] = month.split("-");
        const startDate = `01/${monthNum}/${year}`;
        const lastDay = new Date(parseInt(year), parseInt(monthNum), 0).getDate();
        const endDate = `${lastDay}/${monthNum}/${year}`;

        const bankTxs = await storage.getBankTransactions(clientId, bankAccount.id);
        const txsInMonth = bankTxs.filter(
          tx => tx.amount < 0 && isBetweenDates(tx.date, startDate, endDate)
        );

        // Agrupar por dfcItem
        const grouped = new Map<string, { category: string; item: string; total: number }>();

        for (const tx of txsInMonth) {
          const key = tx.dfcItem || "Sem categoria";
          const existing = grouped.get(key);

          if (existing) {
            existing.total += Math.abs(tx.amount);
          } else {
            grouped.set(key, {
              category: tx.dfcCategory || "Despesas",
              item: tx.dfcItem || "Sem categoria",
              total: Math.abs(tx.amount),
            });
          }
        }

        // Ordenar e pegar top 10
        const sorted = Array.from(grouped.values()).sort((a, b) => b.total - a.total).slice(0, 10);
      
        res.json({ topCosts: sorted });
      } catch (error: any) {
        getLogger(req).error("Erro ao buscar top-costs PJ", {
          event: "pj.dashboard.top-costs",
          context: { clientId: req.query?.clientId },
        }, error);
        res.status(500).json({ error: error.message || "Erro ao buscar top-costs" });
      }
    }
  );
  
  /**
   * GET /api/pj/dashboard/revenue-split
   * Distribuição de receita por canal
   */
  app.get("/api/pj/dashboard/revenue-split", scopeRequired("PJ"), async (req, res) => {
    try {
      const clientId = req.query.clientId as string;
      const month = req.query.month as string; // YYYY-MM
      
      if (!clientId || !month) {
        return res.status(400).json({ error: "clientId e month são obrigatórios" });
      }
      
      const [year, monthNum] = month.split("-");
      const startDate = `01/${monthNum}/${year}`;
      const lastDay = new Date(parseInt(year), parseInt(monthNum), 0).getDate();
      const endDate = `${lastDay}/${monthNum}/${year}`;
      
      const sales = await storage.getSales(clientId);
      const salesInMonth = sales.filter(s => isBetweenDates(s.date, startDate, endDate));
      
      // Agrupar por canal
      const grouped = new Map<string, number>();
      
      for (const sale of salesInMonth) {
        const channel = sale.channel || "Outros";
        grouped.set(channel, (grouped.get(channel) || 0) + sale.grossAmount);
      }
      
      const revenueSplit = Array.from(grouped.entries()).map(([channel, amount]) => ({
        channel,
        amount,
      }));
      
      res.json({ revenueSplit });
    } catch (error: any) {
      getLogger(req).error("Erro ao buscar revenue-split PJ", {
        event: "pj.dashboard.revenue-split",
        context: { clientId: req.query?.clientId },
      }, error);
      res.status(500).json({ error: error.message || "Erro ao buscar revenue-split" });
    }
  });
  
  /**
   * GET /api/pj/dashboard/sales-kpis
   * KPIs de vendas: ticket médio, conversão, top clientes
   */
  app.get("/api/pj/dashboard/sales-kpis", scopeRequired("PJ"), async (req, res) => {
    try {
      const clientId = req.query.clientId as string;
      const month = req.query.month as string; // YYYY-MM
      
      if (!clientId || !month) {
        return res.status(400).json({ error: "clientId e month são obrigatórios" });
      }
      
      const [year, monthNum] = month.split("-");
      const startDate = `01/${monthNum}/${year}`;
      const lastDay = new Date(parseInt(year), parseInt(monthNum), 0).getDate();
      const endDate = `${lastDay}/${monthNum}/${year}`;
      
      const sales = await storage.getSales(clientId);
      const salesInMonth = sales.filter(s => isBetweenDates(s.date, startDate, endDate));
      
      const totalSales = salesInMonth.length;
      const totalRevenue = salesInMonth.reduce((sum, s) => sum + s.grossAmount, 0);
      const ticketMedio = totalSales > 0 ? totalRevenue / totalSales : 0;
      
      // Top clientes
      const customerMap = new Map<string, number>();
      
      for (const sale of salesInMonth) {
        const customerInfo = sale.customer;
        const customerKey =
          customerInfo?.name ||
          customerInfo?.email ||
          customerInfo?.doc ||
          "Cliente desconhecido";
        customerMap.set(customerKey, (customerMap.get(customerKey) || 0) + sale.grossAmount);
      }

      const topClientes = Array.from(customerMap.entries())
        .map(([customer, amount]) => ({ customer, amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5);
      
      res.json({
        totalSales,
        totalRevenue,
        ticketMedio,
        topClientes,
      });
    } catch (error: any) {
      getLogger(req).error("Erro ao buscar sales-kpis PJ", {
        event: "pj.dashboard.sales-kpis",
        context: { clientId: req.query?.clientId },
      }, error);
      res.status(500).json({ error: error.message || "Erro ao buscar sales-kpis" });
    }
  });
  
  /**
   * GET /api/pj/dashboard/dfc
   * Demonstração de Fluxo de Caixa (DFC) por categoria
   */
  app.get(
    "/api/pj/dashboard/dfc",
    scopeRequired("PJ"),
    ensureBankAccountAccess,
    async (req, res) => {
      try {
        const clientId = req.query.clientId as string;
        const month = req.query.month as string; // YYYY-MM

        if (!clientId || !month) {
          return res.status(400).json({ error: "clientId e month são obrigatórios" });
        }

        const bankAccount = req.bankAccountContext;
        if (!bankAccount) {
          return res.status(500).json({ error: "Contexto da conta bancária não carregado" });
        }

        const [year, monthNum] = month.split("-");
        const startDate = `01/${monthNum}/${year}`;
        const lastDay = new Date(parseInt(year), parseInt(monthNum), 0).getDate();
        const endDate = `${lastDay}/${monthNum}/${year}`;

        const bankTxs = await storage.getBankTransactions(clientId, bankAccount.id);
        const txsInMonth = bankTxs.filter(tx => isBetweenDates(tx.date, startDate, endDate));

        // Agrupar por categoria DFC
        const categories = new Map<string, { inflows: number; outflows: number }>();

        for (const tx of txsInMonth) {
          const category = tx.dfcCategory || "Operacional";
          const existing = categories.get(category);

          if (tx.amount > 0) {
            if (existing) {
              existing.inflows += tx.amount;
            } else {
              categories.set(category, { inflows: tx.amount, outflows: 0 });
            }
          } else {
            if (existing) {
              existing.outflows += Math.abs(tx.amount);
            } else {
              categories.set(category, { inflows: 0, outflows: Math.abs(tx.amount) });
            }
          }
        }

        const dfc = Array.from(categories.entries()).map(([category, data]) => ({
          category,
          inflows: data.inflows,
          outflows: data.outflows,
          net: data.inflows - data.outflows,
        }));
      
        res.json({ dfc });
      } catch (error: any) {
        getLogger(req).error("Erro ao buscar DFC PJ", {
          event: "pj.dashboard.cashflow",
          context: { clientId: req.query?.clientId },
        }, error);
        res.status(500).json({ error: error.message || "Erro ao buscar DFC" });
      }
    }
  );
}

