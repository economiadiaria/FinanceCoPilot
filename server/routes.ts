import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { authMiddleware } from "./middleware/auth";
import { requireRole } from "./middleware/rbac";
import { validateClientAccess } from "./middleware/scope";
import { registerOpenFinanceRoutes } from "./openfinance-routes";
import { registerPJRoutes } from "./pj-routes";
import multer from "multer";
import Ofx from "ofx-js";
import crypto from "crypto";
import bcrypt from "bcrypt";
import {
  clientSchema,
  categorizeSchema,
  transactionCategories,
  registerUserSchema,
  loginRequestSchema,
  type Transaction,
  type Summary,
  type RebalanceSuggestion,
  type Report,
  type Position,
  type Client,
  type User,
  type UserProfile,
} from "@shared/schema";
import { z } from "zod";
import { recordAuditEvent, listAuditLogs } from "./security/audit";

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

function sanitizeUser(user: User): UserProfile {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // ===== AUTHENTICATION ROUTES (PUBLIC) =====
  // POST /api/auth/register - Register new user
  app.post("/api/auth/register", async (req, res) => {
    try {
      const data = registerUserSchema.parse(req.body);

      // Check if email already exists
      const existingUser = await storage.getUserByEmail(data.email);
      if (existingUser) {
        return res.status(400).json({ error: "Email já cadastrado" });
      }

      const sessionUser = req.session.userId ? await storage.getUserById(req.session.userId) : undefined;

      if (!sessionUser && data.role !== "master") {
        return res.status(403).json({ error: "Apenas usuários master autenticados podem criar novos acessos" });
      }

      if (sessionUser && sessionUser.role !== "master") {
        return res.status(403).json({ error: "Apenas usuários master podem criar novos acessos" });
      }

      let organizationId = data.organizationId;

      if (sessionUser) {
        organizationId = sessionUser.organizationId;
      }

      if (!organizationId) {
        if (data.role === "master") {
          organizationId = crypto.randomBytes(10).toString("hex");
        } else {
          return res.status(400).json({ error: "Organização obrigatória" });
        }
      }

      if (data.managerId) {
        const manager = await storage.getUserById(data.managerId);
        if (!manager || manager.organizationId !== organizationId || manager.role !== "master") {
          return res.status(400).json({ error: "Master responsável inválido" });
        }
      }

      if (data.consultantId) {
        const consultant = await storage.getUserById(data.consultantId);
        if (!consultant || consultant.organizationId !== organizationId || consultant.role !== "consultor") {
          return res.status(400).json({ error: "Consultor responsável inválido" });
        }
      }

      // Hash password
      const passwordHash = await bcrypt.hash(data.password, 10);

      // Create user
      const userId = crypto.randomBytes(16).toString("hex");
      const user: User = {
        userId,
        email: data.email,
        passwordHash,
        role: data.role,
        name: data.name,
        organizationId,
        clientIds: data.clientIds ?? [],
        managedConsultantIds: data.managedConsultantIds ?? [],
        managedClientIds: data.managedClientIds ?? [],
        managerId: data.managerId,
        consultantId: data.consultantId,
      };

      await storage.createUser(user);

      const respondWithUser = () => {
        res.json({ user: sanitizeUser(user) });
      };

      if (!sessionUser) {
        // Regenerate session ID to prevent fixation attacks on self-registration
        req.session.regenerate((err) => {
          if (err) {
            console.error("Erro ao regenerar sessão:", err);
            return res.status(500).json({ error: "Erro ao criar sessão" });
          }

          // Set session
          req.session.userId = userId;

          // Return user without passwordHash
          respondWithUser();
        });
      } else {
        // Preserve the existing admin session when provisioning new users
        respondWithUser();
      }

      if (sessionUser) {
        recordAuditEvent({
          user: sessionUser,
          eventType: "user.create",
          targetType: "user",
          targetId: userId,
          metadata: { role: data.role },
          piiSnapshot: { email: data.email, name: data.name },
        }).catch(err => {
          console.error("Falha ao registrar auditoria de criação de usuário:", err);
        });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors = error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ');
        return res.status(400).json({ error: fieldErrors });
      }
      console.error("Erro ao registrar usuário:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Erro ao registrar usuário" });
    }
  });

  // POST /api/auth/login - Login user
  app.post("/api/auth/login", async (req, res) => {
    try {
      const data = loginRequestSchema.parse(req.body);
      
      // Find user by email
      const user = await storage.getUserByEmail(data.email);
      if (!user) {
        return res.status(401).json({ error: "Credenciais inválidas" });
      }
      
      // Verify password
      const passwordMatch = await bcrypt.compare(data.password, user.passwordHash);
      if (!passwordMatch) {
        return res.status(401).json({ error: "Credenciais inválidas" });
      }
      
      // Regenerate session ID to prevent fixation attacks
      req.session.regenerate((err) => {
        if (err) {
          console.error("Erro ao regenerar sessão:", err);
          return res.status(500).json({ error: "Erro ao criar sessão" });
        }

        // Set session
        req.session.userId = user.userId;

        // Return user without passwordHash
        const { passwordHash: _, ...userResponse } = user;
        res.json({ user: userResponse });

        recordAuditEvent({
          user,
          eventType: "auth.login",
          targetType: "session",
          metadata: { ip: req.ip },
        }).catch(err => {
          console.error("Falha ao registrar auditoria de login:", err);
        });
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors = error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ');
        return res.status(400).json({ error: fieldErrors });
      }
      console.error("Erro ao fazer login:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Erro ao fazer login" });
    }
  });

  // POST /api/auth/logout - Logout user
  app.post("/api/auth/logout", async (req, res) => {
    const user = req.session.userId ? await storage.getUserById(req.session.userId) : undefined;

    req.session.destroy((err) => {
      if (err) {
        console.error("Erro ao fazer logout:", err);
        return res.status(500).json({ error: "Erro ao fazer logout" });
      }
      res.json({ message: "Logout realizado com sucesso" });
    });

    if (user) {
      recordAuditEvent({
        user,
        eventType: "auth.logout",
        targetType: "session",
        metadata: { ip: req.ip },
      }).catch(err => {
        console.error("Falha ao registrar auditoria de logout:", err);
      });
    }
  });

  // GET /api/auth/me - Get current user
  app.get("/api/auth/me", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Não autenticado" });
      }
      
      const user = await storage.getUserById(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "Usuário não encontrado" });
      }
      
      // Return user without passwordHash
      const { passwordHash: _, ...userResponse } = user;
      res.json({ user: userResponse });
    } catch (error) {
      console.error("Erro ao buscar usuário atual:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Erro ao buscar usuário" });
    }
  });

  // Apply auth middleware to all /api routes EXCEPT auth routes
  app.use("/api", authMiddleware);

  // 1. POST /api/client/upsert - Create/update client
  app.post("/api/client/upsert", requireRole("master", "consultor"), async (req, res) => {
    try {
      const currentUser = req.authUser!;
      const inputSchema = clientSchema.extend({ organizationId: z.string().optional() });
      const data = inputSchema.parse(req.body);
      const consultantId = data.consultantId ?? undefined;
      const masterId = data.masterId ?? undefined;
      const organizationId = currentUser.organizationId;
      const users = (await storage.getUsers()).filter(u => u.organizationId === organizationId);

      const existingClient = await storage.getClient(data.clientId);
      if (existingClient && existingClient.organizationId !== organizationId) {
        return res.status(403).json({ error: "Cliente pertence a outra organização" });
      }

      const consultant = consultantId ? await storage.getUserById(consultantId) : undefined;
      if (consultantId) {
        if (!consultant || consultant.role !== "consultor" || consultant.organizationId !== organizationId) {
          return res.status(400).json({ error: "Consultor responsável inválido" });
        }
      }

      const master = masterId ? await storage.getUserById(masterId) : undefined;
      if (masterId) {
        if (!master || master.role !== "master" || master.organizationId !== organizationId) {
          return res.status(400).json({ error: "Usuário master inválido" });
        }
      }

      const clientPayload: Client = {
        ...data,
        organizationId,
        consultantId: consultantId ?? null,
        masterId: masterId ?? null,
      };

      const client = await storage.upsertClient(clientPayload);
      
      if (consultant) {
        const consultantClientIds = consultant.clientIds ?? [];
        if (!consultantClientIds.includes(client.clientId)) {
          const nextClientIds = Array.from(new Set([...consultantClientIds, client.clientId]));
          await storage.updateUser(consultant.userId, { clientIds: nextClientIds });
        }

        const consultantsToClean = users.filter(u =>
          u.role === "consultor" &&
          u.userId !== consultant.userId &&
          (u.clientIds ?? []).includes(client.clientId)
        );
        await Promise.all(
          consultantsToClean.map(consultantUser =>
            storage.updateUser(consultantUser.userId, {
              clientIds: (consultantUser.clientIds ?? []).filter(id => id !== client.clientId),
            })
          )
        );
      } else {
        const consultantsToClean = users.filter(u =>
          u.role === "consultor" && (u.clientIds ?? []).includes(client.clientId)
        );
        await Promise.all(
          consultantsToClean.map(consultantUser =>
            storage.updateUser(consultantUser.userId, {
              clientIds: (consultantUser.clientIds ?? []).filter(id => id !== client.clientId),
            })
          )
        );
      }

      if (master) {
        const managedIds = master.managedClientIds ?? [];
        if (!managedIds.includes(client.clientId)) {
          const nextManaged = Array.from(new Set([...managedIds, client.clientId]));
          await storage.updateUser(master.userId, { managedClientIds: nextManaged });
        }

        const mastersToClean = users.filter(u =>
          u.role === "master" &&
          u.userId !== master.userId &&
          (u.managedClientIds ?? []).includes(client.clientId)
        );
        await Promise.all(
          mastersToClean.map(masterUser =>
            storage.updateUser(masterUser.userId, {
              managedClientIds: (masterUser.managedClientIds ?? []).filter(id => id !== client.clientId),
            })
          )
        );
      } else {
        const mastersToClean = users.filter(u =>
          u.role === "master" && (u.managedClientIds ?? []).includes(client.clientId)
        );
        await Promise.all(
          mastersToClean.map(masterUser =>
            storage.updateUser(masterUser.userId, {
              managedClientIds: (masterUser.managedClientIds ?? []).filter(id => id !== client.clientId),
            })
          )
        );
      }

      const clientUsers = users.filter(u => u.role === "cliente" && (u.clientIds ?? []).includes(client.clientId));
      const clientUserUpdates = clientUsers
        .map(clientUser => {
          const updates: Partial<User> = {};
          if (clientUser.consultantId !== client.consultantId) {
            updates.consultantId = client.consultantId ?? undefined;
          }
          if (clientUser.managerId !== client.masterId) {
            updates.managerId = client.masterId ?? undefined;
          }
          return { clientUser, updates };
        })
        .filter(({ updates }) => Object.keys(updates).length > 0);

      await Promise.all(
        clientUserUpdates.map(({ clientUser, updates }) =>
          storage.updateUser(clientUser.userId, updates)
        )
      );

      // Associate client with current user if applicable
      const creator = currentUser;
      const eventType = existingClient ? "client.update" : "client.create";

      await recordAuditEvent({
        user: creator,
        eventType,
        targetType: "client",
        targetId: client.clientId,
        metadata: { consultantId, masterId },
        piiSnapshot: { name: client.name, email: client.email },
      });

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
      if (!req.session.userId) {
        return res.status(401).json({ error: "Não autenticado" });
      }

      const currentUser = await storage.getUserById(req.session.userId);
      if (!currentUser) {
        return res.status(401).json({ error: "Usuário não encontrado" });
      }

      let clients = (await storage.getClients()).filter(client => client.organizationId === currentUser.organizationId);

      if (currentUser.role === "consultor") {
        const allowedIds = new Set(currentUser.clientIds ?? []);
        clients = clients.filter(client =>
          allowedIds.has(client.clientId) || client.consultantId === currentUser.userId
        );
      }

      if (currentUser.role === "cliente") {
        const allowedIds = new Set(currentUser.clientIds ?? []);
        clients = clients.filter(client => allowedIds.has(client.clientId));
      }

      res.json(clients);
    } catch (error) {
      console.error("Erro ao buscar clientes:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Erro ao buscar clientes" });
    }
  });

  app.get("/api/users/directory", requireRole("master", "consultor"), async (req, res) => {
    try {
      const currentUser = req.authUser!;

      const users = (await storage.getUsers()).filter(user => user.organizationId === currentUser.organizationId);
      const clients = (await storage.getClients()).filter(client => client.organizationId === currentUser.organizationId);

      const sanitizedUsers = users.map(sanitizeUser);
      const consultants = sanitizedUsers.filter(user => user.role === "consultor");
      const masters = sanitizedUsers.filter(user => user.role === "master");
      const clientUsers = sanitizedUsers.filter(user => user.role === "cliente");

      let visibleClients = clients;
      if (currentUser.role === "consultor") {
        const allowedIds = new Set(currentUser.clientIds ?? []);
        visibleClients = clients.filter(client =>
          allowedIds.has(client.clientId) || client.consultantId === currentUser.userId
        );
      }

      const visibleClientIds = new Set(visibleClients.map(client => client.clientId));
      const visibleClientUsers = currentUser.role === "master"
        ? clientUsers
        : clientUsers.filter(user => (user.clientIds ?? []).some(id => visibleClientIds.has(id)));

      res.json({
        currentUser: sanitizeUser(currentUser),
        consultants,
        masters,
        clients: visibleClients,
        clientUsers: visibleClientUsers,
      });
    } catch (error) {
      console.error("Erro ao montar diretório de usuários:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Erro ao buscar usuários" });
    }
  });

  app.get("/api/audit/logs", requireRole("master"), async (req, res) => {
    try {
      const currentUser = req.authUser!;
      const limit = req.query.limit ? Number(req.query.limit) : 100;
      const logs = await listAuditLogs(currentUser, Number.isNaN(limit) ? 100 : limit);
      res.json({ logs });
    } catch (error) {
      console.error("Erro ao buscar trilha de auditoria:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Erro ao buscar auditoria" });
    }
  });

  app.post("/api/lgpd/anonymize", requireRole("master"), async (req, res) => {
    try {
      const currentUser = req.authUser!;
      const schema = z.object({
        targetType: z.enum(["user", "client"]),
        targetId: z.string().min(1),
      });
      const { targetType, targetId } = schema.parse(req.body);

      let result: User | Client | undefined;
      if (targetType === "user") {
        const target = await storage.getUserById(targetId);
        if (!target || target.organizationId !== currentUser.organizationId) {
          return res.status(404).json({ error: "Usuário não encontrado na organização" });
        }
        result = await storage.anonymizeUser(targetId);
      } else {
        const target = await storage.getClient(targetId);
        if (!target || target.organizationId !== currentUser.organizationId) {
          return res.status(404).json({ error: "Cliente não encontrado na organização" });
        }
        result = await storage.anonymizeClient(targetId);
      }

      if (!result) {
        return res.status(404).json({ error: "Registro não encontrado" });
      }

      await recordAuditEvent({
        user: currentUser,
        eventType: "lgpd.anonymize",
        targetType,
        targetId,
      });

      res.json({ success: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors = error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ');
        return res.status(400).json({ error: fieldErrors });
      }
      console.error("Erro ao anonimizar registro:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Erro ao anonimizar" });
    }
  });

  // GET /api/clients/:clientId - Get single client
  app.get("/api/clients/:clientId", validateClientAccess, async (req, res) => {
    try {
      res.json(req.clientContext);
    } catch (error) {
      console.error("Erro ao buscar cliente:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Erro ao buscar cliente" });
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
      
      // Generate SHA256 hash of file content to prevent duplicate imports
      const fileHash = crypto.createHash("sha256").update(ofxContent).digest("hex");
      
      // Check if this file was already imported
      const existingImport = await storage.getOFXImport(fileHash);
      if (existingImport) {
        return res.status(400).json({ 
          error: "Este arquivo OFX já foi importado anteriormente.",
          importedAt: existingImport.importedAt,
          transactionCount: existingImport.transactionCount
        });
      }
      
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

      // Extract bank name from OFX (try <ORG> first, fallback to <FID>)
      let bankName = "Banco não identificado";
      try {
        const signonInfo = ofxData.OFX.SIGNONMSGSRSV1?.SONRS?.FI;
        if (signonInfo) {
          bankName = signonInfo.ORG || signonInfo.FID || bankName;
        }
      } catch (e) {
        console.log("⚠️ Não foi possível extrair nome do banco do OFX");
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

          // Smart categorization: detect CDB transactions
          let category: Transaction['category'] = undefined;
          let subcategory: string | undefined;
          let status: "pendente" | "categorizada" = "pendente";
          
          if (desc.toUpperCase().includes("CDB")) {
            category = "Investimento";
            status = "categorizada";
            if (amount >= 0) {
              // ENTRADA = Resgate de investimento
              subcategory = "Resgate";
            } else {
              // SAÍDA = Aplicação de investimento
              subcategory = "Aplicação";
            }
          }

          transactions.push({
            date,
            desc,
            amount,
            category,
            subcategory,
            status,
            fitid,
            accountId,
            bankName,
          });

          existingFitIds.add(fitid);
        });
      };

      // Process all accounts
      [...bankAccounts, ...creditCardAccounts].forEach(processAccount);

      if (transactions.length === 0) {
        // Save OFX import record even when no new transactions (prevents re-upload)
        await storage.addOFXImport({
          fileHash,
          clientId,
          importedAt: new Date().toISOString(),
          transactionCount: 0,
        });
        
        return res.json({ 
          success: true, 
          imported: 0, 
          total: existingTransactions.length,
          message: "Nenhuma transação nova encontrada no arquivo OFX."
        });
      }

      await storage.addTransactions(clientId, transactions);
      
      // Save OFX import record to prevent re-import of same file
      await storage.addOFXImport({
        fileHash,
        clientId,
        importedAt: new Date().toISOString(),
        transactionCount: transactions.length,
      });
      
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
          const txn = transactions[index];
          
          // Auto-categorization logic based on amount sign
          if (txn.amount >= 0) {
            // Positive or zero amount = always "Receita"
            txn.category = "Receita";
            txn.subcategory = undefined;
          } else {
            // Negative amount = map UI input shortcuts to valid category enum
            let finalCategory: string;
            
            if (category === "Fixo") {
              finalCategory = "Custo Fixo";
              txn.subcategory = "Fixo";
            } else if (category === "Variável") {
              finalCategory = "Custo Variável";
              txn.subcategory = "Variável";
            } else {
              // Use category as-is (must be valid transactionCategory)
              finalCategory = category;
              txn.subcategory = subcategory;
            }
            
            // Revalidate against transactionCategories enum
            const validCategories: readonly string[] = transactionCategories;
            if (!validCategories.includes(finalCategory)) {
              return res.status(400).json({ 
                error: `Categoria inválida após mapeamento: ${finalCategory}` 
              });
            }
            
            txn.category = finalCategory as any;
          }
          
          txn.status = "categorizada";
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

      // PF-specific insights only
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

  // Register Open Finance routes
  registerOpenFinanceRoutes(app);
  
  // Register PJ routes
  registerPJRoutes(app);

  const httpServer = createServer(app);
  return httpServer;
}
