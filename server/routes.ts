import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { authMiddleware } from "./middleware/auth";
import Papa from "papaparse";
import {
  clientSchema,
  csvImportSchema,
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

  // 2. POST /api/transactions/importCsv - Import CSV transactions
  app.post("/api/transactions/importCsv", async (req, res) => {
    try {
      const { clientId, csvText } = csvImportSchema.parse(req.body);

      if (!clientId) {
        return res.status(400).json({ error: "Informe o clientId." });
      }

      const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

      if (parsed.errors.length > 0) {
        return res.status(400).json({ error: "CSV inválido (colunas: date,desc,amount[,category])." });
      }

      const transactions: Transaction[] = [];
      for (const row of parsed.data as any[]) {
        if (!row.date || !row.desc || row.amount === undefined) {
          continue;
        }

        const transaction: Transaction = {
          date: row.date,
          desc: row.desc,
          amount: parseFloat(row.amount),
          category: row.category && transactionCategories.includes(row.category) ? row.category : undefined,
          status: row.category ? "categorizada" : "pendente",
        };

        transactions.push(transaction);
      }

      await storage.addTransactions(clientId, transactions);
      res.json({ success: true, count: transactions.length });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Erro ao importar CSV" });
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

      res.json(transactions);
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

  const httpServer = createServer(app);
  return httpServer;
}
