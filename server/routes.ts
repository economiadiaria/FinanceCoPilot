import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { authMiddleware } from "./middleware/auth";
import multer from "multer";
import Ofx from "ofx-js";
import crypto from "crypto";
import {
  clientSchema,
  categorizeSchema,
  transactionCategories,
  type Transaction,
  type Summary,
  type RebalanceSuggestion,
  type Report,
  type Position,
  type Client,
} from "@shared/schema";
import { z } from "zod";

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Apply auth middleware to all /api routes
  app.use("/api", authMiddleware);

  // 1. POST /api/client/upsert - Create/update client
  app.post("/api/client/upsert", async (req, res) => {
    try {
      const data = clientSchema.parse(req.body);
      const client = await storage.upsertClient(data);
      res.json(client);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors = error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ');
        return res.status(400).json({ error: fieldErrors });
      }
      res.status(400).json({ error: error instanceof Error ? error.message : "Erro de validação" });
    }
  });

  // GET /api/clients - List all clients
  app.get("/api/clients", async (req, res) => {
    try {
      const clients = await storage.getClients();
      res.json(clients);
    } catch (error) {
      res.status(500).json({ error: "Erro ao buscar clientes" });
    }
  });

  // 2. POST /api/import/ofx - Import OFX file
  app.post("/api/import/ofx", upload.single("ofx"), async (req, res) => {
    try {
      const { clientId } = req.body;

      if (!clientId) {
        return res.status(400).json({ error: "Informe o clientId." });
      }

      if (!req.file) {
        return res.status(400).json({ error: "Nenhum arquivo OFX enviado." });
      }

      const ofxContent = req.file.buffer.toString("utf-8");
      
      // Parse OFX using ofx-js
      let ofxData;
      try {
        ofxData = await Ofx.parse(ofxContent);
        console.log("✅ OFX parseado com sucesso");
      } catch (parseError) {
        console.error("❌ Erro ao fazer parse do OFX:", parseError);
        return res.status(400).json({ 
          error: "Erro ao processar arquivo OFX. Verifique se o arquivo está no formato correto." 
        });
      }
      
      if (!ofxData || !ofxData.OFX) {
        console.error("❌ OFX parseado mas sem estrutura válida:", ofxData);
        return res.status(400).json({ error: "Arquivo OFX inválido ou sem dados." });
      }

      const transactions: Transaction[] = [];
      const existingTransactions = await storage.getTransactions(clientId);
      const existingFitIds = new Set(existingTransactions.map(t => t.fitid).filter(Boolean));

      // Extract transactions from OFX structure
      // Normalize to arrays (OFX parser returns object for single account, array for multiple)
      const bankAccountsRaw = ofxData.OFX.BANKMSGSRSV1?.STMTTRNRS;
      const creditCardAccountsRaw = ofxData.OFX.CREDITCARDMSGSRSV1?.CCSTMTTRNRS;
      
      const bankAccounts = bankAccountsRaw 
        ? (Array.isArray(bankAccountsRaw) ? bankAccountsRaw : [bankAccountsRaw])
        : [];
      const creditCardAccounts = creditCardAccountsRaw
        ? (Array.isArray(creditCardAccountsRaw) ? creditCardAccountsRaw : [creditCardAccountsRaw])
        : [];

      const processAccount = (account: any) => {
        const statement = account.STMTRS || account.CCSTMTRS;
        if (!statement || !statement.BANKTRANLIST || !statement.BANKTRANLIST.STMTTRN) {
          return;
        }

        // Normalize transaction list to array (single transaction returns object)
        const transListRaw = statement.BANKTRANLIST.STMTTRN;
        const transList = Array.isArray(transListRaw) 
          ? transListRaw 
          : [transListRaw];

        const accountId = statement.BANKACCTFROM?.ACCTID || statement.CCACCTFROM?.ACCTID || "unknown";

        transList.forEach((trans: any) => {
          const fitid = trans.FITID || crypto.createHash("md5")
            .update(`${trans.DTPOSTED}-${trans.MEMO || trans.NAME}-${trans.TRNAMT}`)
            .digest("hex");

          // Skip duplicates
          if (existingFitIds.has(fitid)) {
            return;
          }

          // Parse date (OFX format: YYYYMMDD or YYYYMMDDHHMMSS)
          const dateStr = trans.DTPOSTED?.toString().substring(0, 8) || "";
          const date = dateStr ? 
            `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}` : 
            new Date().toISOString().split("T")[0];

          const amount = parseFloat(trans.TRNAMT || "0");
          const desc = trans.MEMO || trans.NAME || "Transação sem descrição";

          transactions.push({
            date,
            desc,
            amount,
            status: "pendente",
            fitid,
            accountId,
          });

          existingFitIds.add(fitid);
        });
      };

      // Process all accounts
      [...bankAccounts, ...creditCardAccounts].forEach(processAccount);

      if (transactions.length === 0) {
        return res.json({ 
          success: true, 
          imported: 0, 
          total: existingTransactions.length,
          message: "Nenhuma transação nova encontrada no arquivo OFX."
        });
      }

      await storage.addTransactions(clientId, transactions);
      
      const totalTransactions = existingTransactions.length + transactions.length;

      res.json({ 
        success: true, 
        imported: transactions.length,
        total: totalTransactions,
        message: `${transactions.length} transações importadas com sucesso.`
      });
    } catch (error) {
      console.error("Erro ao importar OFX:", error);
      res.status(400).json({ 
        error: error instanceof Error ? error.message : "Erro ao importar arquivo OFX" 
      });
    }
  });

  // 3. GET /api/transactions/list - List transactions with filters
  app.get("/api/transactions/list", async (req, res) => {
    try {
      const { clientId, status, from, to, category } = req.query;

      if (!clientId) {
        return res.status(400).json({ error: "Informe o clientId." });
      }

      let transactions = await storage.getTransactions(clientId as string);

      // Apply filters
      if (status && status !== "all") {
        transactions = transactions.filter((t) => t.status === status);
      }
      if (category && category !== "all") {
        transactions = transactions.filter((t) => t.category === category);
      }
      if (from) {
        transactions = transactions.filter((t) => t.date >= from);
      }
      if (to) {
        transactions = transactions.filter((t) => t.date <= to);
      }

      // Calculate totals
      const totalIn = transactions.filter((t) => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
      const totalOut = Math.abs(transactions.filter((t) => t.amount < 0).reduce((sum, t) => sum + t.amount, 0));

      res.json({
        transactions,
        summary: {
          totalIn,
          totalOut,
          count: transactions.length
        }
      });
    } catch (error) {
      res.status(500).json({ error: "Erro ao buscar transações" });
    }
  });

  // 4. POST /api/transactions/categorize - Categorize transactions in bulk
  app.post("/api/transactions/categorize", async (req, res) => {
    try {
      const { clientId, indices, category, subcategory } = categorizeSchema.parse(req.body);

      const transactions = await storage.getTransactions(clientId);

      for (const index of indices) {
        if (index >= 0 && index < transactions.length) {
          transactions[index].category = category;
          transactions[index].subcategory = subcategory;
          transactions[index].status = "categorizada";
        }
      }

      await storage.setTransactions(clientId, transactions);
      res.json({ success: true, updated: indices.length });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Erro ao categorizar" });
    }
  });

  // 5. GET /api/summary - Get financial summary and KPIs
  app.get("/api/summary", async (req, res) => {
    try {
      const { clientId, period } = req.query;

      if (!clientId) {
        return res.status(400).json({ error: "Informe o clientId." });
      }

      const client = await storage.getClient(clientId as string);
      if (!client) {
        return res.status(404).json({ error: "Cliente não encontrado." });
      }

      let transactions = await storage.getTransactions(clientId as string);

      // Filter by period if provided (AAAA-MM)
      if (period) {
        transactions = transactions.filter((t) => t.date.startsWith(period as string));
      }

      const totalIn = transactions.filter((t) => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
      const totalOut = Math.abs(transactions.filter((t) => t.amount < 0).reduce((sum, t) => sum + t.amount, 0));
      const balance = totalIn - totalOut;

      const summary: Summary = {
        totalIn,
        totalOut,
        balance,
        insights: [],
      };

      // Calculate PJ-specific metrics
      if (client.type === "PJ" || client.type === "BOTH") {
        const revenue = totalIn;
        const costs = transactions
          .filter((t) => t.amount < 0 && t.category !== "Impostos")
          .reduce((sum, t) => sum + Math.abs(t.amount), 0);

        const profit = revenue - costs;
        const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

        // Calculate ticket médio (average revenue per transaction)
        const revenueTransactions = transactions.filter((t) => t.amount > 0 && t.category === "Receita");
        const ticketMedio = revenueTransactions.length > 0 ? revenue / revenueTransactions.length : 0;

        // Top costs by category
        const costsByCategory = new Map<string, number>();
        transactions.filter((t) => t.amount < 0 && t.category).forEach((t) => {
          const current = costsByCategory.get(t.category!) || 0;
          costsByCategory.set(t.category!, current + Math.abs(t.amount));
        });

        const topCosts = Array.from(costsByCategory.entries())
          .map(([category, amount]) => ({ category, amount }))
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 5);

        summary.revenue = revenue;
        summary.costs = costs;
        summary.profit = profit;
        summary.margin = margin;
        summary.ticketMedio = ticketMedio;
        summary.topCosts = topCosts;

        // PJ Heuristics
        const taxas = transactions
          .filter((t) => t.amount < 0 && t.category === "Taxas")
          .reduce((sum, t) => sum + Math.abs(t.amount), 0);

        if (revenue > 0 && (taxas / revenue) > 0.05) {
          summary.insights!.push(
            `Suas taxas representam ${((taxas / revenue) * 100).toFixed(1)}% da receita (> 5%). Recomendamos renegociar com adquirente/banco.`
          );
        }

        const positions = await storage.getPositions(clientId as string);
        const totalPositions = positions.reduce((sum, p) => sum + p.value, 0);

        if (totalPositions === 0 && revenue > 0 && balance > revenue * 0.2) {
          summary.insights!.push(
            `Você tem R$ ${balance.toFixed(2)} em caixa parado (> 20% da receita). Sugerimos aplicar em RF curta (D+0/D+1).`
          );
        }
      }

      // Calculate PF-specific metrics
      if (client.type === "PF" || client.type === "BOTH") {
        const lazer = transactions
          .filter((t) => t.amount < 0 && t.category === "Lazer")
          .reduce((sum, t) => sum + Math.abs(t.amount), 0);

        if (totalOut > 0 && (lazer / totalOut) > 0.3) {
          summary.insights!.push(
            `Seus gastos com lazer representam ${((lazer / totalOut) * 100).toFixed(1)}% das saídas (> 30%). Recomendamos estabelecer um teto e reduzir em ${((lazer / totalOut - 0.3) * 100).toFixed(1)}%.`
          );
        }

        // Check investment allocation
        const positions = await storage.getPositions(clientId as string);
        const policy = await storage.getPolicy(clientId as string);

        if (policy && "targets" in policy) {
          const totalValue = positions.reduce((sum, p) => sum + p.value, 0);
          if (totalValue > 0) {
            const rvValue = positions.filter((p) => p.class === "RV").reduce((sum, p) => sum + p.value, 0);
            const rvPct = (rvValue / totalValue) * 100;

            if (rvPct > policy.targets.RV + 10) {
              const diff = rvPct - policy.targets.RV;
              summary.insights!.push(
                `Sua alocação em RV está ${diff.toFixed(1)}pp acima da meta (${rvPct.toFixed(1)}% vs ${policy.targets.RV}%). Sugerimos rebalancear para RF/Fundos.`
              );
            }
          }
        }
      }

      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: "Erro ao calcular resumo" });
    }
  });

  // 6. GET /api/investments/positions - List investment positions
  app.get("/api/investments/positions", async (req, res) => {
    try {
      const { clientId } = req.query;

      if (!clientId) {
        return res.status(400).json({ error: "Informe o clientId." });
      }

      const positions = await storage.getPositions(clientId as string);
      res.json(positions);
    } catch (error) {
      res.status(500).json({ error: "Erro ao buscar posições" });
    }
  });

  // POST /api/investments/positions - Add new position
  app.post("/api/investments/positions", async (req, res) => {
    try {
      const { clientId, position } = req.body;

      if (!clientId) {
        return res.status(400).json({ error: "Informe o clientId." });
      }

      await storage.addPosition(clientId, position);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: "Erro ao adicionar posição" });
    }
  });

  // 7. POST /api/investments/rebalance/suggest - Suggest rebalancing
  app.post("/api/investments/rebalance/suggest", async (req, res) => {
    try {
      const { clientId } = req.body;

      if (!clientId) {
        return res.status(400).json({ error: "Informe o clientId." });
      }

      const client = await storage.getClient(clientId);
      if (!client) {
        return res.status(404).json({ error: "Cliente não encontrado." });
      }

      const positions = await storage.getPositions(clientId);
      const policy = await storage.getPolicy(clientId);
      const suggestions: RebalanceSuggestion[] = [];

      const totalValue = positions.reduce((sum, p) => sum + p.value, 0);

      if (totalValue === 0) {
        return res.json(suggestions);
      }

      // PF Suggestions - Compare current allocation vs targets
      if ((client.type === "PF" || client.type === "BOTH") && policy && "targets" in policy) {
        const classes = ["RF", "RV", "Fundos", "Outros"] as const;

        for (const cls of classes) {
          const classValue = positions.filter((p) => p.class === cls).reduce((sum, p) => sum + p.value, 0);
          const currentPct = (classValue / totalValue) * 100;
          const targetPct = policy.targets[cls];
          const difference = currentPct - targetPct;

          if (Math.abs(difference) > 1) {
            const action = difference > 0
              ? `Vender R$ ${(Math.abs(difference / 100) * totalValue).toFixed(2)}`
              : `Comprar R$ ${(Math.abs(difference / 100) * totalValue).toFixed(2)}`;

            suggestions.push({
              class: cls,
              currentPct,
              targetPct,
              difference,
              action,
            });
          }
        }
      }

      // PJ Suggestions - Check cash policy limits
      if ((client.type === "PJ" || client.type === "BOTH") && policy && "cashPolicy" in policy) {
        const rfValue = positions.filter((p) => p.class === "RF").reduce((sum, p) => sum + p.value, 0);
        const rvValue = positions.filter((p) => p.class === "RV").reduce((sum, p) => sum + p.value, 0);

        const rfPct = (rfValue / totalValue) * 100;
        const rvPct = (rvValue / totalValue) * 100;

        // Check minRF
        if (rfPct < policy.cashPolicy.minRF) {
          const diff = policy.cashPolicy.minRF - rfPct;
          suggestions.push({
            class: "RF",
            currentPct: rfPct,
            targetPct: policy.cashPolicy.minRF,
            difference: -diff,
            action: `Aumentar alocação em RF em ${diff.toFixed(1)}pp (mínimo ${policy.cashPolicy.minRF}%)`,
          });
        }

        // Check maxRV
        if (rvPct > policy.cashPolicy.maxRV) {
          const diff = rvPct - policy.cashPolicy.maxRV;
          suggestions.push({
            class: "RV",
            currentPct: rvPct,
            targetPct: policy.cashPolicy.maxRV,
            difference: diff,
            action: `Reduzir alocação em RV em ${diff.toFixed(1)}pp (máximo ${policy.cashPolicy.maxRV}%)`,
          });
        }

        // Check maxDurationDays - positions with maturity
        const today = new Date();
        for (const position of positions.filter((p) => p.maturity)) {
          const maturity = new Date(position.maturity!);
          const daysToMaturity = Math.floor((maturity.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

          if (daysToMaturity > policy.cashPolicy.maxDurationDays) {
            suggestions.push({
              class: position.class,
              currentPct: 0,
              targetPct: 0,
              difference: daysToMaturity - policy.cashPolicy.maxDurationDays,
              action: `${position.asset} vence em ${daysToMaturity} dias (máximo ${policy.cashPolicy.maxDurationDays}). Considere resgate antecipado.`,
            });
          }
        }
      }

      res.json(suggestions);
    } catch (error) {
      res.status(500).json({ error: "Erro ao gerar sugestões" });
    }
  });

  // 8. POST /api/reports/generate - Generate monthly report
  app.post("/api/reports/generate", async (req, res) => {
    try {
      const { clientId, period, notes } = req.body;

      if (!clientId || !period) {
        return res.status(400).json({ error: "Informe clientId e period." });
      }

      const client = await storage.getClient(clientId);
      if (!client) {
        return res.status(404).json({ error: "Cliente não encontrado." });
      }

      // Get summary for the period
      const transactions = (await storage.getTransactions(clientId)).filter((t) =>
        t.date.startsWith(period)
      );

      const totalIn = transactions.filter((t) => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
      const totalOut = Math.abs(transactions.filter((t) => t.amount < 0).reduce((sum, t) => sum + t.amount, 0));

      const revenue = totalIn;
      const costs = transactions
        .filter((t) => t.amount < 0 && t.category !== "Impostos")
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);
      const profit = revenue - costs;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

      const revenueTransactions = transactions.filter((t) => t.amount > 0 && t.category === "Receita");
      const ticketMedio = revenueTransactions.length > 0 ? revenue / revenueTransactions.length : 0;

      const costsByCategory = new Map<string, number>();
      transactions.filter((t) => t.amount < 0 && t.category).forEach((t) => {
        const current = costsByCategory.get(t.category!) || 0;
        costsByCategory.set(t.category!, current + Math.abs(t.amount));
      });

      const topCosts = Array.from(costsByCategory.entries())
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5);

      const report: Report = {
        revenue,
        costs,
        profit,
        margin,
        ticketMedio,
        topCosts,
        notes,
      };

      await storage.setReport(clientId, period, report);

      // Generate HTML
      const html = `
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
          <meta charset="UTF-8">
          <title>Relatório ${period} - ${client.name}</title>
          <style>
            body { font-family: Inter, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; }
            h1 { color: #1e40af; }
            .metric { margin: 20px 0; padding: 20px; background: #f3f4f6; border-radius: 8px; }
            .metric-label { font-size: 12px; color: #6b7280; text-transform: uppercase; }
            .metric-value { font-size: 32px; font-weight: bold; margin-top: 8px; }
            .positive { color: #059669; }
            .negative { color: #dc2626; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { text-align: left; padding: 12px; border-bottom: 1px solid #e5e7eb; }
            th { background: #f9fafb; font-weight: 600; }
            @media print { .no-print { display: none; } }
          </style>
        </head>
        <body>
          <h1>Relatório Mensal - ${period}</h1>
          <p><strong>Cliente:</strong> ${client.name} (${client.type})</p>
          <p><strong>Gerado em:</strong> ${new Date().toLocaleDateString("pt-BR")}</p>

          <div class="metric">
            <div class="metric-label">Receita Total</div>
            <div class="metric-value positive">R$ ${revenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</div>
          </div>

          <div class="metric">
            <div class="metric-label">Lucro Líquido</div>
            <div class="metric-value ${profit > 0 ? "positive" : "negative"}">R$ ${profit.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</div>
          </div>

          <div class="metric">
            <div class="metric-label">Margem Líquida</div>
            <div class="metric-value">${margin.toFixed(1)}%</div>
          </div>

          ${ticketMedio > 0 ? `
          <div class="metric">
            <div class="metric-label">Ticket Médio</div>
            <div class="metric-value">R$ ${ticketMedio.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</div>
          </div>
          ` : ""}

          <h2>Top 5 Custos</h2>
          <table>
            <thead>
              <tr>
                <th>Categoria</th>
                <th style="text-align: right;">Valor</th>
              </tr>
            </thead>
            <tbody>
              ${topCosts.map((item) => `
                <tr>
                  <td>${item.category}</td>
                  <td style="text-align: right;">R$ ${item.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>

          ${notes ? `
          <h2>Observações</h2>
          <p>${notes}</p>
          ` : ""}
        </body>
        </html>
      `;

      await storage.setReportHtml(clientId, period, html);
      res.json({ success: true, html });
    } catch (error) {
      res.status(500).json({ error: "Erro ao gerar relatório" });
    }
  });

  // 9. GET /api/reports/view - View report
  app.get("/api/reports/view", async (req, res) => {
    try {
      const { clientId, period } = req.query;

      if (!clientId || !period) {
        return res.status(400).json({ error: "Informe clientId e period." });
      }

      let html = await storage.getReportHtml(clientId as string, period as string);

      // If no HTML found, try to generate on-the-fly
      if (!html) {
        const report = await storage.getReport(clientId as string, period as string);
        if (!report) {
          return res.status(404).json({ error: "Relatório não encontrado." });
        }

        const client = await storage.getClient(clientId as string);
        if (!client) {
          return res.status(404).json({ error: "Cliente não encontrado." });
        }

        // Generate basic HTML from saved report
        html = `
          <!DOCTYPE html>
          <html lang="pt-BR">
          <head>
            <meta charset="UTF-8">
            <title>Relatório ${period} - ${client.name}</title>
            <style>
              body { font-family: Inter, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; }
              h1 { color: #1e40af; }
              .metric { margin: 20px 0; padding: 20px; background: #f3f4f6; border-radius: 8px; }
              .metric-label { font-size: 12px; color: #6b7280; text-transform: uppercase; }
              .metric-value { font-size: 32px; font-weight: bold; margin-top: 8px; }
            </style>
          </head>
          <body>
            <h1>Relatório ${period} - ${client.name}</h1>
            <div class="metric">
              <div class="metric-label">Receita</div>
              <div class="metric-value">R$ ${report.revenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</div>
            </div>
            <div class="metric">
              <div class="metric-label">Lucro</div>
              <div class="metric-value">R$ ${report.profit.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</div>
            </div>
            <div class="metric">
              <div class="metric-label">Margem</div>
              <div class="metric-value">${report.margin.toFixed(1)}%</div>
            </div>
          </body>
          </html>
        `;
      }

      res.send(html);
    } catch (error) {
      res.status(500).json({ error: "Erro ao visualizar relatório" });
    }
  });

  // 10. POST /api/policies/upsert - Update policies
  app.post("/api/policies/upsert", async (req, res) => {
    try {
      const { clientId, data } = req.body;

      if (!clientId) {
        return res.status(400).json({ error: "Informe o clientId." });
      }

      await storage.setPolicy(clientId, data);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: "Erro ao atualizar políticas" });
    }
  });

  // GET /api/policies - Get policies
  app.get("/api/policies", async (req, res) => {
    try {
      const { clientId } = req.query;

      if (!clientId) {
        return res.status(400).json({ error: "Informe o clientId." });
      }

      const policy = await storage.getPolicy(clientId as string);
      res.json(policy || {});
    } catch (error) {
      res.status(500).json({ error: "Erro ao buscar políticas" });
    }
  });

  // API Documentation endpoint
  app.get("/api/docs", (req, res) => {
    const docsHtml = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>API Documentation - Copiloto Financeiro</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; 
            line-height: 1.6; 
            color: #1f2937;
            background: #f9fafb;
            padding: 20px;
          }
          .container { max-width: 1200px; margin: 0 auto; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
          h1 { color: #1e40af; margin-bottom: 10px; font-size: 32px; }
          h2 { color: #1e40af; margin-top: 40px; margin-bottom: 20px; font-size: 24px; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px; }
          h3 { color: #374151; margin-top: 30px; margin-bottom: 15px; font-size: 18px; }
          .subtitle { color: #6b7280; margin-bottom: 30px; font-size: 16px; }
          .endpoint { 
            background: #f3f4f6; 
            padding: 20px; 
            border-radius: 8px; 
            margin-bottom: 30px;
            border-left: 4px solid #2563eb;
          }
          .method { 
            display: inline-block;
            padding: 4px 12px;
            border-radius: 4px;
            font-weight: 600;
            font-size: 12px;
            margin-right: 10px;
          }
          .method.post { background: #059669; color: white; }
          .method.get { background: #2563eb; color: white; }
          .path { 
            font-family: 'Monaco', 'Courier New', monospace; 
            font-size: 14px;
            color: #1f2937;
            font-weight: 600;
          }
          .description { margin: 15px 0; color: #4b5563; }
          .params, .response { 
            background: white; 
            padding: 15px; 
            border-radius: 6px; 
            margin-top: 15px;
            border: 1px solid #e5e7eb;
          }
          .params h4, .response h4 { 
            font-size: 14px; 
            color: #6b7280; 
            text-transform: uppercase; 
            margin-bottom: 10px;
            letter-spacing: 0.5px;
          }
          pre { 
            background: #1f2937; 
            color: #f9fafb; 
            padding: 15px; 
            border-radius: 6px; 
            overflow-x: auto;
            font-size: 13px;
            line-height: 1.5;
          }
          code { 
            font-family: 'Monaco', 'Courier New', monospace;
            background: #f3f4f6;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 13px;
          }
          .note { 
            background: #fef3c7; 
            border-left: 4px solid #f59e0b;
            padding: 15px; 
            margin: 20px 0;
            border-radius: 6px;
          }
          .note strong { color: #92400e; }
          ul { margin-left: 20px; margin-top: 10px; }
          li { margin-bottom: 8px; color: #4b5563; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🚀 Copiloto Financeiro - API Documentation</h1>
          <p class="subtitle">API REST para gestão financeira de Pessoa Física e Jurídica</p>

          <div class="note">
            <strong>⚠️ Autenticação:</strong> Todos os endpoints requerem o header <code>X-API-KEY</code> com a chave de API válida.
          </div>

          <h2>📊 Gestão de Clientes</h2>

          <div class="endpoint">
            <div>
              <span class="method post">POST</span>
              <span class="path">/api/client/upsert</span>
            </div>
            <p class="description">Criar ou atualizar um cliente</p>
            <div class="params">
              <h4>Body (JSON)</h4>
              <pre>{
  "clientId": "empresa_abc",
  "name": "Empresa ABC Ltda",
  "type": "PJ",  // "PF", "PJ" ou "BOTH"
  "email": "contato@empresaabc.com"
}</pre>
            </div>
          </div>

          <div class="endpoint">
            <div>
              <span class="method get">GET</span>
              <span class="path">/api/clients</span>
            </div>
            <p class="description">Listar todos os clientes cadastrados</p>
          </div>

          <h2>💰 Gestão de Transações</h2>

          <div class="endpoint">
            <div>
              <span class="method post">POST</span>
              <span class="path">/api/import/ofx</span>
            </div>
            <p class="description">Importar transações via arquivo OFX bancário</p>
            <div class="params">
              <h4>Form Data (multipart/form-data)</h4>
              <ul>
                <li><strong>clientId:</strong> ID do cliente</li>
                <li><strong>ofx:</strong> Arquivo .ofx (até 5MB)</li>
              </ul>
            </div>
            <div class="response">
              <h4>Resposta</h4>
              <pre>{
  "success": true,
  "imported": 45,
  "total": 120,
  "message": "45 transações importadas com sucesso."
}</pre>
            </div>
            <div class="note">
              <strong>💡 Deduplicação:</strong> O sistema usa o FITID do OFX ou gera um hash (data+desc+valor) para evitar duplicatas.
            </div>
          </div>

          <div class="endpoint">
            <div>
              <span class="method get">GET</span>
              <span class="path">/api/transactions/list</span>
            </div>
            <p class="description">Listar transações com filtros opcionais</p>
            <div class="params">
              <h4>Query Parameters</h4>
              <ul>
                <li><strong>clientId</strong> (obrigatório): ID do cliente</li>
                <li><strong>status</strong> (opcional): pendente, categorizada, revisar, all</li>
                <li><strong>category</strong> (opcional): Receita, Custo Fixo, etc.</li>
                <li><strong>from</strong> (opcional): Data inicial (YYYY-MM-DD)</li>
                <li><strong>to</strong> (opcional): Data final (YYYY-MM-DD)</li>
              </ul>
            </div>
            <div class="response">
              <h4>Resposta</h4>
              <pre>{
  "transactions": [...],
  "summary": {
    "totalIn": 15000.00,
    "totalOut": 8500.00,
    "count": 42
  }
}</pre>
            </div>
          </div>

          <div class="endpoint">
            <div>
              <span class="method post">POST</span>
              <span class="path">/api/transactions/categorize</span>
            </div>
            <p class="description">Categorizar múltiplas transações em lote</p>
            <div class="params">
              <h4>Body (JSON)</h4>
              <pre>{
  "clientId": "empresa_abc",
  "indices": [0, 3, 7],  // índices das transações
  "category": "Custo Fixo",
  "subcategory": "Aluguel"  // opcional
}</pre>
            </div>
          </div>

          <h2>📈 Análises e KPIs</h2>

          <div class="endpoint">
            <div>
              <span class="method get">GET</span>
              <span class="path">/api/summary</span>
            </div>
            <p class="description">Obter resumo financeiro e KPIs do período</p>
            <div class="params">
              <h4>Query Parameters</h4>
              <ul>
                <li><strong>clientId</strong> (obrigatório): ID do cliente</li>
                <li><strong>period</strong> (opcional): YYYY-MM (ex: 2025-10)</li>
              </ul>
            </div>
            <div class="response">
              <h4>Resposta (PJ)</h4>
              <pre>{
  "totalIn": 25000.00,
  "totalOut": 12000.00,
  "balance": 13000.00,
  "revenue": 25000.00,
  "costs": 10500.00,
  "profit": 14500.00,
  "margin": 58.0,
  "ticketMedio": 2500.00,
  "topCosts": [
    { "category": "Custo Fixo", "amount": 5000.00 },
    ...
  ],
  "insights": [
    "Suas taxas representam 6.2% da receita (> 5%). Recomendamos renegociar..."
  ]
}</pre>
            </div>
            <div class="note">
              <strong>🧠 Heurísticas Inteligentes:</strong>
              <ul>
                <li><strong>PF:</strong> Alertas sobre Lazer > 30%, RV > target + 10pp</li>
                <li><strong>PJ:</strong> Alertas sobre Taxas > 5%, Caixa parado > 20% receita</li>
              </ul>
            </div>
          </div>

          <h2>💼 Investimentos</h2>

          <div class="endpoint">
            <div>
              <span class="method get">GET</span>
              <span class="path">/api/investments/positions</span>
            </div>
            <p class="description">Listar posições de investimentos</p>
            <div class="params">
              <h4>Query Parameters</h4>
              <ul>
                <li><strong>clientId</strong> (obrigatório): ID do cliente</li>
              </ul>
            </div>
          </div>

          <div class="endpoint">
            <div>
              <span class="method post">POST</span>
              <span class="path">/api/investments/positions</span>
            </div>
            <p class="description">Adicionar nova posição de investimento</p>
            <div class="params">
              <h4>Body (JSON)</h4>
              <pre>{
  "clientId": "empresa_abc",
  "asset": "CDB Banco XYZ",
  "class": "RF",  // RF, RV, Fundos, Outros
  "value": 15000.00,
  "rate": 12.5,  // opcional (% a.a.)
  "liquidity": "D+1",  // opcional
  "maturity": "2026-12-31"  // opcional (YYYY-MM-DD)
}</pre>
            </div>
          </div>

          <div class="endpoint">
            <div>
              <span class="method post">POST</span>
              <span class="path">/api/investments/rebalance/suggest</span>
            </div>
            <p class="description">Obter sugestões de rebalanceamento de carteira</p>
            <div class="params">
              <h4>Body (JSON)</h4>
              <pre>{ "clientId": "empresa_abc" }</pre>
            </div>
            <div class="response">
              <h4>Resposta (PF)</h4>
              <pre>[
  {
    "class": "RV",
    "currentPct": 35,
    "targetPct": 20,
    "difference": 15,
    "action": "Reduzir RV em 15pp, investindo em RF/Fundos."
  }
]</pre>
            </div>
          </div>

          <h2>📄 Relatórios</h2>

          <div class="endpoint">
            <div>
              <span class="method post">POST</span>
              <span class="path">/api/reports/generate</span>
            </div>
            <p class="description">Gerar relatório mensal em HTML</p>
            <div class="params">
              <h4>Body (JSON)</h4>
              <pre>{
  "clientId": "empresa_abc",
  "period": "2025-10",
  "notes": "Mês com crescimento de 15% em vendas."  // opcional
}</pre>
            </div>
            <div class="response">
              <h4>Resposta</h4>
              <pre>{
  "success": true,
  "html": "&lt;!DOCTYPE html&gt;..."
}</pre>
            </div>
          </div>

          <div class="endpoint">
            <div>
              <span class="method get">GET</span>
              <span class="path">/api/reports/view</span>
            </div>
            <p class="description">Visualizar relatório HTML gerado</p>
            <div class="params">
              <h4>Query Parameters</h4>
              <ul>
                <li><strong>clientId</strong> (obrigatório): ID do cliente</li>
                <li><strong>period</strong> (obrigatório): YYYY-MM</li>
              </ul>
            </div>
            <div class="note">
              <strong>💾 Exportar PDF:</strong> Abra a rota no navegador e use Ctrl+P ou Cmd+P para salvar como PDF.
            </div>
          </div>

          <h2>⚙️ Políticas de Investimento</h2>

          <div class="endpoint">
            <div>
              <span class="method post">POST</span>
              <span class="path">/api/policies/upsert</span>
            </div>
            <p class="description">Atualizar políticas de investimento</p>
            <div class="params">
              <h4>Body para PF</h4>
              <pre>{
  "clientId": "joao_pf",
  "data": {
    "targets": { "RF": 60, "RV": 20, "Fundos": 15, "Outros": 5 },
    "rule50_30_20": true
  }
}</pre>
              <h4>Body para PJ</h4>
              <pre>{
  "clientId": "empresa_abc",
  "data": {
    "cashPolicy": {
      "minRF": 70,
      "maxRV": 10,
      "maxIssuerPct": 30,
      "maxDurationDays": 365
    }
  }
}</pre>
            </div>
          </div>

          <div class="endpoint">
            <div>
              <span class="method get">GET</span>
              <span class="path">/api/policies</span>
            </div>
            <p class="description">Obter políticas configuradas</p>
            <div class="params">
              <h4>Query Parameters</h4>
              <ul>
                <li><strong>clientId</strong> (obrigatório): ID do cliente</li>
              </ul>
            </div>
          </div>

          <h2>🔐 Autenticação</h2>
          <p>Todos os endpoints requerem o header <code>X-API-KEY</code>. Exemplo:</p>
          <pre>curl -H "X-API-KEY: sua-chave-aqui" https://seu-app.replit.app/api/clients</pre>

          <div class="note" style="margin-top: 40px;">
            <strong>📚 Mais informações:</strong> Consulte o arquivo <code>replit.md</code> para detalhes sobre a arquitetura e como testar a aplicação.
          </div>
        </div>
      </body>
      </html>
    `;
    
    res.send(docsHtml);
  });

  const httpServer = createServer(app);
  return httpServer;
}
