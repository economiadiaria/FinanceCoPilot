import type { Express } from "express";
import { storage } from "./storage";
import { authMiddleware } from "./middleware/auth";
import { validateClientAccess } from "./middleware/scope";
import { pluggyClient, hasPluggyCredentials } from "./pluggy";
import { getLogger } from "./observability/logger";
import type { OFItem, OFAccount, Transaction, Position } from "@shared/schema";
import { v4 as uuidv4 } from "uuid";

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
    try {
      const event = req.body;

      if (!event || !event.data) {
        return res.status(400).json({ error: "Payload inválido" });
      }

      const { itemId, event: eventType, data } = event;

      // Get client ID from item (stored when item was created)
      // For now, we'll update the item status based on event type
      getLogger(req).info("Webhook received", {
        event: "openfinance.webhook",
        context: { eventType, itemId },
      });

      // Update item status based on event type
      if (eventType === "item/created" || eventType === "item/updated") {
        // Item was successfully created or updated
        // Mark for sync in next call
        getLogger(req).info("Item ready for sync", {
          event: "openfinance.webhook.ready",
          context: { itemId },
        });
      } else if (eventType === "item/error" || eventType === "item/login_error") {
        // Update item status to error
        getLogger(req).warn("Item reported error", {
          event: "openfinance.webhook.error",
          context: {
            itemId,
            code: data?.code ?? data?.errorCode ?? null,
            status: data?.status ?? null,
          },
        });
      }

      res.json({ received: true });
    } catch (error: any) {
      getLogger(req).error("Error processing webhook", {
        event: "openfinance.webhook",
      }, error);
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
