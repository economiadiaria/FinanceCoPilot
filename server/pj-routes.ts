import type { Express } from "express";
import { storage } from "./storage";
import { scopeRequired } from "./middleware/scope";
import multer from "multer";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import Ofx from "ofx-js";
import {
  type Sale,
  type SaleLeg,
  type SettlementParcel,
  type PaymentMethod,
  type BankTransaction,
} from "@shared/schema";
import { addDays, addMonths, formatBR, toISOFromBR, inPeriod } from "@shared/utils";
import { z } from "zod";

// Configure multer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

/**
 * Calcula o plano de liquidação (settlementPlan) baseado no método de pagamento
 */
function calculateSettlementPlan(
  saleDate: string, // DD/MM/YYYY
  method: PaymentMethod | undefined,
  installments: number,
  netAmount: number
): SettlementParcel[] {
  const plan: SettlementParcel[] = [];
  
  // Padrão se não houver configuração
  const liquidacao = method?.liquidacao || "D+1";
  
  if (liquidacao.startsWith("D+") && !liquidacao.includes("por_parcela")) {
    // D+X: parcela única
    const days = parseInt(liquidacao.substring(2));
    plan.push({
      n: 1,
      due: addDays(saleDate, days),
      expected: netAmount,
    });
  } else if (liquidacao.includes("por_parcela")) {
    // D+30_por_parcela: múltiplas parcelas a cada 30 dias (primeira parcela em +30 dias)
    const amountPerInstallment = netAmount / installments;
    
    for (let i = 0; i < installments; i++) {
      plan.push({
        n: i + 1,
        due: addMonths(saleDate, i + 1), // +1 para começar 30 dias após a venda
        expected: amountPerInstallment,
      });
    }
  } else {
    // Fallback: D+1
    plan.push({
      n: 1,
      due: addDays(saleDate, 1),
      expected: netAmount,
    });
  }
  
  return plan;
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
      
      res.json({ 
        success: true, 
        sale,
        legs: saleLegs,
      });
    } catch (error: any) {
      console.error("Erro ao adicionar venda PJ:", error);
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
      console.error("Erro ao listar vendas PJ:", error);
      res.status(500).json({ error: error.message || "Erro ao listar vendas" });
    }
  });
  
  /**
   * POST /api/pj/sales/importCsv
   * Importação de vendas via CSV
   * Formato: date;invoiceNumber;customer_name;customer_doc;channel;item;qty;unit_price;discount;payment_method;gateway;installments;gross_leg;fees_leg;status;comment
   */
  app.post("/api/pj/sales/importCsv", scopeRequired("PJ"), upload.single("csv"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Arquivo CSV não enviado" });
      }
      
      const clientId = req.body.clientId;
      if (!clientId) {
        return res.status(400).json({ error: "clientId é obrigatório" });
      }
      
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
      
      res.json({
        success: true,
        imported,
        skipped,
        total: salesMap.size,
      });
    } catch (error: any) {
      console.error("Erro ao importar CSV de vendas:", error);
      res.status(500).json({ error: error.message || "Erro ao importar CSV" });
    }
  });
  
  // ===== BANCO PJ =====
  
  /**
   * POST /api/pj/import/ofx
   * Importar extrato bancário via OFX com deduplicação SHA256
   */
  app.post("/api/pj/import/ofx", scopeRequired("PJ"), upload.single("ofx"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Arquivo OFX não enviado" });
      }
      
      const clientId = req.body.clientId;
      if (!clientId) {
        return res.status(400).json({ error: "clientId é obrigatório" });
      }
      
      // Calcular hash do arquivo (deduplicação)
      const fileContent = req.file.buffer.toString("utf-8");
      const fileHash = crypto.createHash("sha256").update(fileContent).digest("hex");
      
      // Verificar se já foi importado
      const existingImport = await storage.getOFXImport(fileHash);
      if (existingImport) {
        return res.status(409).json({ 
          error: "OFX duplicado. Este arquivo já foi importado anteriormente.",
          importedAt: existingImport.importedAt,
        });
      }
      
      // Parse OFX
      const ofxData = Ofx.parse(fileContent);
      
      // Extrair transações
      const existingBankTxs = await storage.getBankTransactions(clientId);
      const newTransactions: BankTransaction[] = [];
      
      // OFX pode ter múltiplas contas
      const accounts = ofxData.OFX?.BANKMSGSRSV1?.STMTTRNRS || [];
      const accountsArray = Array.isArray(accounts) ? accounts : [accounts];
      
      for (const account of accountsArray) {
        const statement = account.STMTRS;
        if (!statement) continue;
        
        const accountId = statement.BANKACCTFROM?.ACCTID || "unknown";
        const transactions = statement.BANKTRANLIST?.STMTTRN || [];
        const txArray = Array.isArray(transactions) ? transactions : [transactions];
        
        for (const tx of txArray) {
          const date = tx.DTPOSTED ? formatBR(tx.DTPOSTED.substring(0, 8)) : "";
          const amount = parseFloat(tx.TRNAMT) || 0;
          const desc = tx.MEMO || tx.NAME || "Sem descrição";
          const fitid = tx.FITID;
          
          // Dedup por fitid ou (date + amount + desc)
          const dupKey = fitid || `${date}-${amount}-${desc}`;
          const isDup = existingBankTxs.some(t => 
            (t.fitid && t.fitid === fitid) ||
            (t.date === date && t.amount === amount && t.desc === desc)
          );
          
          if (!isDup) {
            const bankTx: BankTransaction = {
              bankTxId: uuidv4(),
              date,
              desc,
              amount,
              accountId,
              fitid,
              sourceHash: fileHash,
              linkedLegs: [],
              reconciled: false,
            };
            
            newTransactions.push(bankTx);
          }
        }
      }
      
      // Salvar transações
      await storage.addBankTransactions(clientId, newTransactions);
      
      // Registrar importação
      await storage.addOFXImport({
        fileHash,
        clientId,
        importedAt: new Date().toISOString(),
        transactionCount: newTransactions.length,
      });
      
      res.json({
        success: true,
        imported: newTransactions.length,
        total: newTransactions.length,
      });
    } catch (error: any) {
      console.error("Erro ao importar OFX PJ:", error);
      res.status(500).json({ error: error.message || "Erro ao importar OFX" });
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
      console.error("Erro ao sugerir conciliação PJ:", error);
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
      
      res.json({
        success: true,
        leg,
        reconciliationState: leg.reconciliation.state,
        reconciledParcels,
        totalParcels,
      });
    } catch (error: any) {
      console.error("Erro ao confirmar conciliação PJ:", error);
      res.status(400).json({ error: error.message || "Erro ao confirmar conciliação" });
    }
  });
}
