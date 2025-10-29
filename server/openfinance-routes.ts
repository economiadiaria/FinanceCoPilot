import type { Express, Request } from "express";
import crypto from "node:crypto";
import { storage } from "./storage";
import { authMiddleware } from "./middleware/auth";
import { validateClientAccess } from "./middleware/scope";
import { pluggyClient, hasPluggyCredentials } from "./pluggy";
import { getLogger, type RequestLogger } from "./observability/logger";
import { recordAuditEvent } from "./security/audit";
import type { Client, OFItem, OFAccount, Transaction, Position, User } from "@shared/schema";
import { v4 as uuidv4 } from "uuid";

type RawBodyRequest = Request & { rawBody?: Buffer | string };

const WEBHOOK_TIMESTAMP_HEADER = "x-pluggy-timestamp";
const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

function getRawBodyBuffer(req: Request): Buffer | null {
  const raw = (req as RawBodyRequest).rawBody;

  if (Buffer.isBuffer(raw)) {
    return raw;
  }

  if (typeof raw === "string") {
    return Buffer.from(raw, "utf8");
  }

  if (typeof req.body === "string") {
    return Buffer.from(req.body, "utf8");
  }

  if (Buffer.isBuffer(req.body)) {
    (req as RawBodyRequest).rawBody = req.body;
    return req.body;
  }

  if (req.body && typeof req.body === "object") {
    try {
      return Buffer.from(JSON.stringify(req.body));
    } catch {
      return null;
    }
  }

  return null;
}

function extractEventPayload(req: Request, rawBody: Buffer): any {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    return undefined;
  }
}

// Helper to format date from ISO to DD/MM/YYYY
function formatDateBR(isoDate: string): string {
  const date = new Date(isoDate);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// Helper to normalize Pluggy account type
function normalizeAccountType(pluggyType: string): string {
  const typeMap: Record<string, string> = {
    "CHECKING_ACCOUNT": "CHECKING",
    "SAVINGS_ACCOUNT": "SAVINGS",
    "CREDIT_CARD": "CREDIT_CARD",
    "INVESTMENT": "INVESTMENT",
  };
  return typeMap[pluggyType] || pluggyType;
}

type WebhookSignatureMetadata = {
  provided: string | null;
  computed: string | null;
  timestamp: string | null;
};

type BankAccountContext = {
  bankAccountId?: string;
  bankAccountIds: string[];
  client?: Client;
};

function extractAccountIdsFromEvent(eventType: string | undefined, data: unknown): string[] {
  const ids = new Set<string>();

  const add = (value: unknown) => {
    if (typeof value === "string" && value.trim() !== "") {
      ids.add(value);
    }
  };

  const handleAccountLike = (value: unknown): void => {
    if (!value) {
      return;
    }
    if (typeof value === "string") {
      add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(handleAccountLike);
      return;
    }
    if (typeof value === "object") {
      const account = value as Record<string, unknown>;
      add(account.id);
      add(account.accountId);
      add(account.account_id);
      if ("account" in account) {
        handleAccountLike(account.account);
      }
    }
  };

  const handleTransactionLike = (value: unknown): void => {
    if (!value) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(handleTransactionLike);
      return;
    }
    if (typeof value === "object") {
      const transaction = value as Record<string, unknown>;
      add(transaction.accountId);
      add(transaction.account_id);
      if ("account" in transaction) {
        handleAccountLike(transaction.account);
      }
      if ("transaction" in transaction) {
        handleTransactionLike(transaction.transaction);
      }
      if ("transactions" in transaction) {
        handleTransactionLike(transaction.transactions);
      }
    }
  };

  if (!data) {
    return [];
  }

  if (typeof data === "string") {
    add(data);
    return Array.from(ids);
  }

  const isAccountEvent = /account/i.test(eventType ?? "");
  const isTransactionEvent = /transaction/i.test(eventType ?? "");

  if (Array.isArray(data)) {
    for (const item of data) {
      if (isAccountEvent) {
        handleAccountLike(item);
      }
      if (isTransactionEvent) {
        handleTransactionLike(item);
      }
    }
    return Array.from(ids);
  }

  if (typeof data === "object") {
    const payload = data as Record<string, unknown>;
    add(payload.accountId);
    add(payload.account_id);
    if ("account" in payload) {
      handleAccountLike(payload.account);
    }
    if (isAccountEvent) {
      handleAccountLike(payload);
      if ("accounts" in payload) {
        handleAccountLike(payload.accounts);
      }
    }
    if (isTransactionEvent) {
      handleTransactionLike(payload);
      if ("transactions" in payload) {
        handleTransactionLike(payload.transactions);
      }
      if ("transaction" in payload) {
        handleTransactionLike(payload.transaction);
      }
    }
  }

  return Array.from(ids);
}

async function findClientByItemId(itemId: string): Promise<Client | undefined> {
  const clients = await storage.getClients();
  for (const client of clients) {
    const items = await storage.getOFItems(client.clientId);
    if (items.some(item => item.itemId === itemId)) {
      return client;
    }
  }
  return undefined;
}

async function resolveWebhookContext(
  eventType: string | undefined,
  itemId: string | undefined,
  data: unknown
): Promise<BankAccountContext> {
  const context: BankAccountContext = { bankAccountIds: [] };
  if (itemId) {
    context.client = await findClientByItemId(itemId);
  }

  const relevantEvent = /account|transaction/i.test(eventType ?? "");
  if (!relevantEvent) {
    return context;
  }

  const accountIds = new Set<string>(extractAccountIdsFromEvent(eventType, data));

  if (accountIds.size === 0 && context.client && itemId) {
    const accounts = await storage.getOFAccounts(context.client.clientId);
    for (const account of accounts) {
      if (account.itemId === itemId) {
        accountIds.add(account.accountId);
      }
    }
  }

  context.bankAccountIds = Array.from(accountIds);
  context.bankAccountId = context.bankAccountIds[0];
  return context;
}

function createSystemAuditUser(organizationId?: string): User {
  return {
    userId: "system-openfinance-webhook",
    email: "openfinance-webhook@system.local",
    passwordHash: "system",
    role: "master",
    name: "Open Finance Webhook",
    organizationId: organizationId ?? "system",
    clientIds: [],
    managedConsultantIds: [],
    managedClientIds: [],
  } satisfies User;
}

async function recordWebhookAudit(
  logger: RequestLogger,
  {
    outcome,
    reason,
    signature,
    pluggyEventType,
    itemId,
    bankAccountContext,
  }: {
    outcome: "accepted" | "rejected";
    reason?: string;
    signature: WebhookSignatureMetadata;
    pluggyEventType?: string;
    itemId?: string;
    bankAccountContext: BankAccountContext;
  }
): Promise<void> {
  const eventType =
    outcome === "accepted" ? "openfinance.webhook.accepted" : "openfinance.webhook.rejected";

  const signatureMetadata = {
    provided: signature.provided ?? null,
    computed: signature.computed ?? null,
    timestamp: signature.timestamp ?? null,
  };

  const metadata = {
    pluggyEventType: pluggyEventType ?? null,
    itemId: itemId ?? null,
    clientId: bankAccountContext.client?.clientId ?? null,
    bankAccountId: bankAccountContext.bankAccountId ?? null,
    bankAccountIds: bankAccountContext.bankAccountIds,
    signature: signatureMetadata,
    reason: reason ?? null,
  };

  try {
    await recordAuditEvent({
      user: createSystemAuditUser(bankAccountContext.client?.organizationId),
      eventType,
      targetType: "openfinance.webhook",
      targetId: bankAccountContext.bankAccountId ?? itemId ?? undefined,
      metadata,
    });
  } catch (error) {
    logger.error(
      "Failed to record Open Finance webhook audit entry",
      {
        event: "openfinance.webhook.audit",
        context: { outcome },
      },
      error
    );
  }
}

export function registerOpenFinanceRoutes(app: Express) {
  // POST /api/openfinance/consent/start - Create connect token
  app.post("/api/openfinance/consent/start", authMiddleware, validateClientAccess, async (req, res) => {
    try {
      const { clientId } = req.body;

      if (!clientId) {
        return res.status(400).json({ error: "clientId é obrigatório" });
      }

      const user = req.authUser;
      const client = req.clientContext;

      if (!user) {
        return res.status(401).json({ error: "Usuário não encontrado" });
      }

      if (!client || client.clientId !== clientId) {
        return res.status(400).json({ error: "Contexto do cliente não carregado" });
      }

      // Check if Pluggy credentials are configured
      if (!hasPluggyCredentials()) {
        return res.json({
          mode: "simulado",
          message: "Credenciais do Pluggy não configuradas. Modo simulado ativo.",
        });
      }

      // Create connect token
      const connectToken = await pluggyClient.createConnectToken(clientId);

      // Initialize sync metadata if not exists
      const syncMeta = await storage.getOFSyncMeta(clientId);
      if (!syncMeta) {
        await storage.setOFSyncMeta(clientId, {});
      }

      res.json({
        mode: "real",
        connectToken,
        widget: {
          connectToken,
          language: "pt",
        },
      });
    } catch (error: any) {
      getLogger(req).error("Error creating connect token", {
        event: "openfinance.connect-token",
        context: { clientId: req.body?.clientId },
      }, error);
      res.status(500).json({ error: error.message || "Erro ao criar token de conexão" });
    }
  });

  // POST /api/openfinance/webhook - Receive Pluggy webhooks
  app.post("/api/openfinance/webhook", async (req, res) => {
    const logger = getLogger(req);
    const signatureMetadata: WebhookSignatureMetadata = {
      provided: req.get("x-pluggy-signature") ?? null,
      computed: null,
      timestamp: req.get(WEBHOOK_TIMESTAMP_HEADER) ?? null,
    };
    let pluggyEventType: string | undefined;
    let pluggyItemId: string | undefined;
    let bankAccountContext: BankAccountContext = { bankAccountIds: [] };
    let auditRecorded = false;

    const emitAudit = async (outcome: "accepted" | "rejected", reason?: string) => {
      await recordWebhookAudit(logger, {
        outcome,
        reason,
        signature: signatureMetadata,
        pluggyEventType,
        itemId: pluggyItemId,
        bankAccountContext,
      });
      auditRecorded = true;
    };

    const rejectRequest = async (status: number, message: string, reason: string) => {
      await emitAudit("rejected", reason);
      return res.status(status).json({ error: message });
    };

    try {
      const webhookSecret = process.env.PLUGGY_WEBHOOK_SECRET?.trim();

      if (!webhookSecret) {
        logger.error("Pluggy webhook secret not configured", {
          event: "openfinance.webhook.auth",
        });
        return rejectRequest(500, "Segredo do webhook não configurado", "secret-not-configured");
      }

      if (!signatureMetadata.provided) {
        logger.warn("Missing Pluggy webhook signature", {
          event: "openfinance.webhook.auth",
        });
        return rejectRequest(401, "Assinatura obrigatória", "missing-signature");
      }

      if (!signatureMetadata.timestamp) {
        logger.warn("Missing Pluggy webhook timestamp", {
          event: "openfinance.webhook.auth",
        });
        return rejectRequest(401, "Timestamp obrigatório", "missing-timestamp");
      }

      const timestampDate = new Date(signatureMetadata.timestamp);
      const timestampMs = timestampDate.getTime();

      if (
        Number.isNaN(timestampMs) ||
        timestampDate.toISOString() !== signatureMetadata.timestamp
      ) {
        logger.warn("Invalid Pluggy webhook timestamp format", {
          event: "openfinance.webhook.auth",
          context: { timestampHeader: signatureMetadata.timestamp },
        });
        return rejectRequest(401, "Timestamp inválido", "invalid-timestamp");
      }

      if (Math.abs(Date.now() - timestampMs) > WEBHOOK_TIMESTAMP_TOLERANCE_MS) {
        logger.warn("Stale Pluggy webhook timestamp", {
          event: "openfinance.webhook.auth",
          context: { timestampHeader: signatureMetadata.timestamp },
        });
        return rejectRequest(401, "Timestamp expirado", "stale-timestamp");
      }

      const rawBody = getRawBodyBuffer(req);

      if (!rawBody) {
        logger.warn("Missing raw body for Pluggy webhook", {
          event: "openfinance.webhook.auth",
        });
        return rejectRequest(400, "Payload inválido", "missing-raw-body");
      }

      const computedSignature = crypto
        .createHmac("sha256", webhookSecret)
        .update(rawBody)
        .digest("hex");
      signatureMetadata.computed = computedSignature;

      const providedSignatureBuffer = Buffer.from(signatureMetadata.provided, "utf8");
      const computedSignatureBuffer = Buffer.from(computedSignature, "utf8");
      const signatureMatches =
        providedSignatureBuffer.length === computedSignatureBuffer.length &&
        crypto.timingSafeEqual(providedSignatureBuffer, computedSignatureBuffer);

      if (!signatureMatches) {
        logger.warn("Invalid Pluggy webhook signature", {
          event: "openfinance.webhook.auth",
        });
        return rejectRequest(403, "Assinatura inválida", "invalid-signature");
      }

      const eventPayload = extractEventPayload(req, rawBody);
      const eventTypeValue =
        typeof eventPayload?.event === "string" ? (eventPayload.event as string) : undefined;
      const itemIdValue =
        typeof eventPayload?.itemId === "string" ? (eventPayload.itemId as string) : undefined;
      const eventData = eventPayload?.data;

      pluggyEventType = eventTypeValue;
      pluggyItemId = itemIdValue;
      bankAccountContext = await resolveWebhookContext(eventTypeValue, itemIdValue, eventData);

      if (!eventPayload || !eventPayload.data) {
        return rejectRequest(400, "Payload inválido", "invalid-payload");
      }

      const eventType = eventTypeValue ?? "";
      const itemId = itemIdValue;
      const dedupeKey = `${computedSignature}:${signatureMetadata.timestamp}`;

      if (await storage.hasProcessedWebhook(dedupeKey)) {
        const duplicateContext: Record<string, unknown> = { dedupeKey };
        if (pluggyEventType) duplicateContext.eventType = pluggyEventType;
        if (pluggyItemId) duplicateContext.itemId = pluggyItemId;
        if (bankAccountContext.bankAccountIds.length > 0) {
          duplicateContext.bankAccountIds = bankAccountContext.bankAccountIds;
        }
        logger.warn("Duplicate Pluggy webhook received", {
          event: "openfinance.webhook.duplicate",
          ...(bankAccountContext.bankAccountId
            ? { bankAccountId: bankAccountContext.bankAccountId }
            : {}),
          context: duplicateContext,
        });
        return rejectRequest(409, "Webhook duplicado", "duplicate");
      }

      const webhookLogContext: Record<string, unknown> = {
        eventType,
        itemId,
      };
      if (bankAccountContext.bankAccountIds.length > 0) {
        webhookLogContext.bankAccountIds = bankAccountContext.bankAccountIds;
      }

      logger.info("Webhook received", {
        event: "openfinance.webhook",
        ...(bankAccountContext.bankAccountId
          ? { bankAccountId: bankAccountContext.bankAccountId }
          : {}),
        context: webhookLogContext,
      });

      // Update item status based on event type
      if (eventType === "item/created" || eventType === "item/updated") {
        logger.info("Item ready for sync", {
          event: "openfinance.webhook.ready",
          context: { itemId },
        });
      } else if (eventType === "item/error" || eventType === "item/login_error") {
        logger.warn("Item reported error", {
          event: "openfinance.webhook.error",
          context: {
            itemId,
            code: eventPayload.data?.code ?? eventPayload.data?.errorCode ?? null,
            status: eventPayload.data?.status ?? null,
          },
        });
      }

      await storage.registerProcessedWebhook(dedupeKey, signatureMetadata.timestamp);
      await emitAudit("accepted");

      res.status(202).json({ received: true });
    } catch (error: any) {
      logger.error("Error processing webhook", {
        event: "openfinance.webhook",
      }, error);
      if (!auditRecorded) {
        const reason = error instanceof Error ? error.message : String(error);
        await emitAudit("rejected", reason);
      }
      res.status(500).json({ error: error.message || "Erro ao processar webhook" });
    }
  });

  // POST /api/openfinance/sync - Sync accounts, transactions, and positions
  app.post("/api/openfinance/sync", authMiddleware, validateClientAccess, async (req, res) => {
    try {
      const { clientId, full = false } = req.body;

      if (!clientId) {
        return res.status(400).json({ error: "clientId é obrigatório" });
      }

      const client = req.clientContext;

      if (!client || client.clientId !== clientId) {
        return res.status(400).json({ error: "Contexto do cliente não carregado" });
      }

      // Check if in simulated mode
      if (!hasPluggyCredentials()) {
        // Simulated mode: create fake data
        const fakeItem: OFItem = {
          itemId: "fake-item-" + Date.now(),
          institutionName: "Banco Simulado",
          status: "active",
          createdAt: new Date().toISOString(),
          lastSyncAt: new Date().toISOString(),
        };

        await storage.setOFItems(clientId, [fakeItem]);

        // Create fake account
        const fakeAccount: OFAccount = {
          accountId: "fake-acc-" + Date.now(),
          itemId: fakeItem.itemId,
          name: "Conta Corrente Simulada",
          type: "CHECKING",
          currency: "BRL",
          balance: 5000,
        };

        await storage.setOFAccounts(clientId, [fakeAccount]);

        // Create fake transactions
        const fakeTransactions: Transaction[] = [
          {
            date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
            desc: "Salário - Empresa XYZ",
            amount: 5000,
            status: "pendente",
            provider: "pluggy",
            providerTxId: "fake-tx-1",
            providerAccountId: fakeAccount.accountId,
          },
          {
            date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
            desc: "Supermercado ABC",
            amount: -150.50,
            status: "pendente",
            provider: "pluggy",
            providerTxId: "fake-tx-2",
            providerAccountId: fakeAccount.accountId,
          },
          {
            date: new Date().toISOString().split("T")[0],
            desc: "Transferência PIX",
            amount: -200,
            status: "pendente",
            provider: "pluggy",
            providerTxId: "fake-tx-3",
            providerAccountId: fakeAccount.accountId,
          },
        ];

        await storage.addTransactions(clientId, fakeTransactions);

        // Create fake position
        const fakePosition: Position = {
          asset: "Tesouro Selic 2027",
          class: "RF",
          value: 10000,
          rate: 6.5,
          liquidity: "D+0",
          maturity: "2027-12-31",
          provider: "pluggy",
          providerPosId: "fake-pos-1",
          providerAccountId: fakeAccount.accountId,
        };

        await storage.addPosition(clientId, fakePosition);

        // Update sync meta
        await storage.setOFSyncMeta(clientId, {
          lastTxSyncAt: new Date().toISOString(),
          lastPosSyncAt: new Date().toISOString(),
        });

        return res.json({
          mode: "simulado",
          synced: {
            accounts: 1,
            transactions: 3,
            positions: 1,
          },
          items: [fakeItem],
        });
      }

      // Real mode: sync with Pluggy
      const items = await storage.getOFItems(clientId);

      if (items.length === 0) {
        return res.status(400).json({ error: "Nenhuma conexão encontrada. Conecte um banco primeiro." });
      }

      const syncMeta = await storage.getOFSyncMeta(clientId) || {};
      const allAccounts: OFAccount[] = [];
      const allTransactions: Transaction[] = [];
      const allPositions: Position[] = [];

      // Sync each item
      for (const item of items) {
        try {
          // 1. Sync accounts
          const pluggyAccounts = await pluggyClient.getAccounts(item.itemId);

          for (const acc of pluggyAccounts) {
            const normalizedAccount: OFAccount = {
              accountId: acc.id,
              itemId: item.itemId,
              name: acc.name,
              type: normalizeAccountType(acc.type),
              currency: acc.currencyCode || "BRL",
              balance: acc.balance,
            };
            allAccounts.push(normalizedAccount);

            // 2. Sync transactions
            const fromDate = full ? undefined : syncMeta.lastTxSyncAt;
            const pluggyTxs = await pluggyClient.getTransactions(acc.id, fromDate);

            // Get existing transactions to dedupe
            const existingTxs = await storage.getTransactions(clientId);
            const existingProviderIds = new Set(existingTxs
              .filter(t => t.providerTxId)
              .map(t => t.providerTxId!));

            for (const tx of pluggyTxs) {
              // Skip duplicates
              if (existingProviderIds.has(tx.id)) continue;

              const normalizedTx: Transaction = {
                date: tx.date?.split("T")[0] || new Date().toISOString().split("T")[0],
                desc: tx.description || "Transação",
                amount: tx.amount || 0,
                status: "pendente",
                provider: "pluggy",
                providerTxId: tx.id,
                providerAccountId: acc.id,
                bankName: item.institutionName,
              };
              allTransactions.push(normalizedTx);
            }

            // 3. Sync investments/positions
            const pluggyInvestments = await pluggyClient.getInvestments(acc.id);

            // Get existing positions to dedupe
            const existingPos = await storage.getPositions(clientId);
            const existingPosIds = new Set(existingPos
              .filter(p => p.providerPosId)
              .map(p => p.providerPosId!));

            for (const inv of pluggyInvestments) {
              // Skip duplicates
              if (existingPosIds.has(inv.id)) continue;

              // Determine asset class
              const assetClass = inv.type === "EQUITY" || inv.type === "STOCK" ? "RV" :
                                 inv.type === "FUND" ? "Fundos" :
                                 inv.type === "FIXED_INCOME" ? "RF" : "Outros";

              const normalizedPos: Position = {
                asset: inv.name || "Investimento",
                class: assetClass,
                value: inv.balance || 0,
                rate: inv.rate,
                maturity: inv.dueDate,
                provider: "pluggy",
                providerPosId: inv.id,
                providerAccountId: acc.id,
              };
              allPositions.push(normalizedPos);
            }
          }

          // Update item sync time
          item.lastSyncAt = new Date().toISOString();
        } catch (error: any) {
          getLogger(req).error("Error syncing item", {
            event: "openfinance.sync.item",
            context: { clientId, itemId: item.itemId },
          }, error);
          item.status = "error";
        }
      }

      // Save all synced data
      await storage.setOFAccounts(clientId, allAccounts);
      await storage.addTransactions(clientId, allTransactions);

      for (const pos of allPositions) {
        await storage.addPosition(clientId, pos);
      }

      // Update items and sync meta
      await storage.setOFItems(clientId, items);
      await storage.setOFSyncMeta(clientId, {
        lastTxSyncAt: new Date().toISOString(),
        lastPosSyncAt: new Date().toISOString(),
      });

      res.json({
        mode: "real",
        synced: {
          accounts: allAccounts.length,
          transactions: allTransactions.length,
          positions: allPositions.length,
        },
        items: items.map(item => ({
          ...item,
          lastSyncAt: item.lastSyncAt ? formatDateBR(item.lastSyncAt) : undefined,
          createdAt: formatDateBR(item.createdAt),
        })),
      });
    } catch (error: any) {
      getLogger(req).error("Error syncing data", {
        event: "openfinance.sync",
        context: { clientId: req.body?.clientId },
      }, error);
      res.status(500).json({ error: error.message || "Erro ao sincronizar dados" });
    }
  });

  // GET /api/openfinance/items - List client connections
  app.get("/api/openfinance/items", authMiddleware, validateClientAccess, async (req, res) => {
    try {
      const { clientId } = req.query;

      if (!clientId || typeof clientId !== "string") {
        return res.status(400).json({ error: "clientId é obrigatório" });
      }

      const client = req.clientContext;

      if (!client || client.clientId !== clientId) {
        return res.status(400).json({ error: "Contexto do cliente não carregado" });
      }

      const items = await storage.getOFItems(clientId);

      // Format dates for display
      const formattedItems = items.map(item => ({
        ...item,
        lastSyncAt: item.lastSyncAt ? formatDateBR(item.lastSyncAt) : undefined,
        createdAt: formatDateBR(item.createdAt),
      }));

      res.json({ items: formattedItems });
    } catch (error: any) {
      getLogger(req).error("Error getting items", {
        event: "openfinance.items",
        context: { clientId: req.query?.clientId },
      }, error);
      res.status(500).json({ error: error.message || "Erro ao buscar conexões" });
    }
  });
}
