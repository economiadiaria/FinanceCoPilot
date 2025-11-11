import type { Express, NextFunction, Request, Response } from "express";
import { createServer, type Server } from "http";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import Ofx from "ofx-js";
import crypto from "crypto";
import bcrypt from "bcrypt";
import yaml from "yaml";
import { storage } from "./storage";
import { authMiddleware } from "./middleware/auth";
import { requireRole } from "./middleware/rbac";
import { validateClientAccess } from "./middleware/scope";
import { registerOpenFinanceRoutes } from "./openfinance-routes";
import { registerPJRoutes } from "./pj-routes";
import { registerPjPlanRoutes } from "./pj-plan-routes";
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
import { getLogger, updateRequestLoggerContext } from "./observability/logger";
import { metricsRegistry } from "./observability/metrics";
import {
  evaluateReadinessDependencies,
  type DependencyStatus,
} from "./observability/readiness";
import { getDb, type Database } from "./db/client";
import { onboardPjClientCategories } from "./pj-client-category-onboarding";

type SwaggerUiModule = typeof import("swagger-ui-express");

let swaggerUiModulePromise: Promise<SwaggerUiModule | null> | null = null;

const resolveSwaggerUi = async (): Promise<SwaggerUiModule | null> => {
  if (!swaggerUiModulePromise) {
    swaggerUiModulePromise = import("swagger-ui-express")
      .then((module) => (module.default ?? module) as SwaggerUiModule)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Swagger UI desabilitado: ${message}`);
        return null;
      });
  }

  return swaggerUiModulePromise;
};

const openApiSpecPath = path.resolve(process.cwd(), "docs/openapi/pj-banking.yaml");
const openApiSpec = yaml.parse(fs.readFileSync(openApiSpecPath, "utf8")) as Record<string, unknown>;

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

function sanitizeUser(user: User): UserProfile {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

type RouteDependencies = {
  db?: Database;
};

export async function registerRoutes(
  app: Express,
  dependencies: RouteDependencies = {},
): Promise<Server> {
  const resolveDatabase = (): Database => dependencies.db ?? getDb();

  app.use((req, res, next) => {
    if (!req.requestId) {
      const header = req.headers["x-request-id"];
      const requestId = Array.isArray(header) ? header[0] : header;
      if (typeof requestId === "string" && requestId.length > 0) {
        req.requestId = requestId;
        if (!res.getHeader("X-Request-Id")) {
          res.setHeader("X-Request-Id", requestId);
        }
      }
    }

    next();
  });

  app.get("/healthz", (_req, res) => {
    res.status(200).json({
      status: "ok",
      service: process.env.SERVICE_NAME ?? "financecopilot-api",
      commit: process.env.GIT_COMMIT_SHA ?? null,
      buildTime: process.env.BUILD_TIMESTAMP ?? null,
    });
  });

  app.get("/readyz", async (_req, res) => {
    const { dependencies: baseDependencies } = await evaluateReadinessDependencies();
    const dependencies: Record<string, DependencyStatus> = { ...baseDependencies };

    try {
      await storage.checkHealth();
      dependencies.storage = { status: "ok" };
    } catch (error) {
      dependencies.storage = {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }

    const healthy = Object.values(dependencies).every(
      (dependency) => dependency.status === "ok" || dependency.status === "skipped"
    );

    res.status(healthy ? 200 : 503).json({
      status: healthy ? "ok" : "error",
      dependencies,
    });
  });

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

      // Regenerate session ID to prevent fixation attacks
      req.session.regenerate((err) => {
        if (err) {
          getLogger(req).error("Erro ao regenerar sessão", {
            event: "auth.session.regenerate",
          }, err);
          return res.status(500).json({ error: "Erro ao criar sessão" });
        }

        // Set session
        req.session.userId = userId;

        // Return user without passwordHash
        const { passwordHash: _, ...userResponse } = user;
        res.json({ user: userResponse });
      });

      if (sessionUser) {
        await recordAuditEvent({
          user: sessionUser,
          eventType: "user.create",
          targetType: "user",
          targetId: userId,
          metadata: { role: data.role },
          piiSnapshot: { email: data.email, name: data.name },
        });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors = error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ');
        return res.status(400).json({ error: fieldErrors });
      }
      getLogger(req).error("Erro ao registrar usuário", {
        event: "auth.register",
      }, error);
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

      updateRequestLoggerContext(req, { userId: user.userId });

      // Regenerate session ID to prevent fixation attacks
      req.session.regenerate((err) => {
        if (err) {
          getLogger(req).error("Erro ao regenerar sessão", {
            event: "auth.session.regenerate",
          }, err);
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
          getLogger(req).error("Falha ao registrar auditoria de login", {
            event: "audit.log",
          }, err);
        });
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors = error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ');
        return res.status(400).json({ error: fieldErrors });
      }
      getLogger(req).error("Erro ao fazer login", {
        event: "auth.login",
      }, error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Erro ao fazer login" });
    }
  });

  // POST /api/auth/logout - Logout user
  app.post("/api/auth/logout", async (req, res) => {
    const user = req.session.userId ? await storage.getUserById(req.session.userId) : undefined;

    req.session.destroy((err) => {
      if (err) {
        getLogger(req).error("Erro ao fazer logout", {
          event: "auth.logout",
        }, err);
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
        getLogger(req).error("Falha ao registrar auditoria de logout", {
          event: "audit.log",
        }, err);
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
      getLogger(req).error("Erro ao buscar usuário atual", {
        event: "auth.me",
      }, error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Erro ao buscar usuário" });
    }
  });

  // Apply auth middleware to all /api routes EXCEPT auth routes
  app.use("/api", authMiddleware);

  app.get("/api/internal/metrics", requireRole("master"), async (_req, res) => {
    res.set("Content-Type", metricsRegistry.contentType);
    res.send(await metricsRegistry.metrics());
  });

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

      const requestLogger = getLogger(req);
      updateRequestLoggerContext(req, { clientId: data.clientId });

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

      const shouldProvisionPjPlan =
        !existingClient && (clientPayload.type === "PJ" || clientPayload.type === "BOTH");

      if (shouldProvisionPjPlan) {
        const onboardingLogger = requestLogger.child({
          event: "pj.client.onboarding",
          clientId: clientPayload.clientId,
          userId: currentUser.userId,
        });

        try {
          const database = resolveDatabase();
          await database.transaction(async transaction => {
            await onboardPjClientCategories({
              orgId: organizationId,
              clientId: clientPayload.clientId,
              storage,
              transaction,
              logger: onboardingLogger,
            });
          });
        } catch (error) {
          onboardingLogger.error(
            "Failed to provision PJ client categories",
            {
              event: "pj.client.onboarding.failed",
              clientId: clientPayload.clientId,
              userId: currentUser.userId,
              context: { orgId: organizationId },
            },
            error,
          );

          await recordAuditEvent({
            user: currentUser,
            eventType: "pj.client.onboarding.failed",
            targetType: "client",
            targetId: clientPayload.clientId,
            metadata: {
              reason: error instanceof Error ? error.message : String(error),
            },
          });

          return res.status(500).json({
            error: "Não foi possível configurar as categorias PJ do cliente.",
          });
        }
      }

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
      getLogger(req).error("Erro ao buscar clientes", {
        event: "clients.list",
      }, error);
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
      getLogger(req).error("Erro ao montar diretório de usuários", {
        event: "users.directory",
      }, error);
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
      getLogger(req).error("Erro ao buscar trilha de auditoria", {
        event: "audit.list",
      }, error);
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
      getLogger(req).error("Erro ao anonimizar registro", {
        event: "lgpd.anonymize",
      }, error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Erro ao anonimizar" });
    }
  });

  // GET /api/clients/:clientId - Get single client
  app.get("/api/clients/:clientId", validateClientAccess, async (req, res) => {
    try {
      res.json(req.clientContext);
    } catch (error) {
      getLogger(req).error("Erro ao buscar cliente", {
        event: "clients.detail",
      }, error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Erro ao buscar cliente" });
    }
  });

  // 2. POST /api/import/ofx - Import OFX file
  app.post(
    "/api/import/ofx",
    upload.single("ofx"),
    validateClientAccess,
    async (req, res) => {
      let clientIdForLogging: string | null = null;
      try {
        const client = req.clientContext;

        if (!client || !req.authUser) {
          return res.status(500).json({ error: "Contexto do cliente não carregado" });
        }

        if (req.body?.clientId && req.body.clientId !== client.clientId) {
          return res.status(400).json({ error: "clientId inconsistente com o contexto carregado" });
        }

        const ensuredClientId = client.clientId;
        clientIdForLogging = ensuredClientId;

        if (!req.file) {
          return res.status(400).json({ error: "Nenhum arquivo OFX enviado." });
        }

        const ofxContent = req.file.buffer.toString("utf-8");

        // Generate SHA256 hash of file content to prevent duplicate imports
        const fileHash = crypto.createHash("sha256").update(ofxContent).digest("hex");

        // Parse OFX using ofx-js
        let ofxData;
        try {
          ofxData = await Ofx.parse(ofxContent);
          getLogger(req).info("OFX parseado com sucesso", {
            event: "pf.ofx.parse.success",
            context: { clientId: ensuredClientId },
          });
        } catch (parseError) {
          getLogger(req).error("Erro ao fazer parse do OFX", {
            event: "pf.ofx.parse.failure",
            context: { clientId: ensuredClientId },
          }, parseError);
          return res.status(400).json({
            error: "Erro ao processar arquivo OFX. Verifique se o arquivo está no formato correto."
          });
        }

        if (!ofxData || !ofxData.OFX) {
          getLogger(req).error("OFX parseado mas sem estrutura válida", {
            event: "pf.ofx.structure.invalid",
            context: { clientId: ensuredClientId },
          }, ofxData);
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
          getLogger(req).warn("Não foi possível extrair nome do banco do OFX", {
            event: "pf.ofx.bankname.missing",
            context: { clientId: ensuredClientId },
          }, e);
        }

        const transactions: Transaction[] = [];
        const existingTransactions = await storage.getTransactions(ensuredClientId);
        const existingFitIds = new Set(existingTransactions.map(t => t.fitid).filter(Boolean));

        const parseStatementDate = (value?: string): string | undefined => {
          if (!value) {
            return undefined;
          }
          const trimmed = value.toString().trim();
          if (trimmed.length < 8) {
            return undefined;
          }
          return `${trimmed.substring(0, 4)}-${trimmed.substring(4, 6)}-${trimmed.substring(6, 8)}`;
        };

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

        const accountSummaries: {
          accountId: string;
          statementStart?: string;
          statementEnd?: string;
          transactionCount: number;
        }[] = [];
        const duplicateAccounts = new Set<string>();

        for (const account of [...bankAccounts, ...creditCardAccounts]) {
          const statement = account.STMTRS || account.CCSTMTRS;
          if (!statement || !statement.BANKTRANLIST || !statement.BANKTRANLIST.STMTTRN) {
            continue;
          }

          const transListRaw = statement.BANKTRANLIST.STMTTRN;
          const transList = Array.isArray(transListRaw)
            ? transListRaw
            : [transListRaw];

          const accountId = statement.BANKACCTFROM?.ACCTID || statement.CCACCTFROM?.ACCTID || "unknown";
          const statementStart = parseStatementDate(statement.BANKTRANLIST.DTSTART);
          const statementEnd = parseStatementDate(statement.BANKTRANLIST.DTEND);

          const existingImport = await storage.getOFXImport(ensuredClientId, accountId, fileHash);
          if (existingImport) {
            duplicateAccounts.add(accountId);
          }

          transList.forEach((trans: any) => {
            const fitid = trans.FITID || crypto.createHash("md5")
              .update(`${trans.DTPOSTED}-${trans.MEMO || trans.NAME}-${trans.TRNAMT}`)
              .digest("hex");

            if (existingFitIds.has(fitid)) {
              return;
            }

            const dateStr = trans.DTPOSTED?.toString().substring(0, 8) || "";
            const date = dateStr
              ? `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`
              : new Date().toISOString().split("T")[0];

            const amount = parseFloat(trans.TRNAMT || "0");
            const desc = trans.MEMO || trans.NAME || "Transação sem descrição";

            let category: Transaction['category'] = undefined;
            let subcategory: string | undefined;
            let status: "pendente" | "categorizada" = "pendente";

            if (desc.toUpperCase().includes("CDB")) {
              category = "Investimento";
              status = "categorizada";
              if (amount >= 0) {
                subcategory = "Resgate";
              } else {
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

          accountSummaries.push({
            accountId,
            statementStart,
            statementEnd,
            transactionCount: transList.length,
          });
        }

        if (transactions.length === 0) {
          const importedAt = new Date().toISOString();
          await Promise.all(
            accountSummaries.map(summary =>
              storage.addOFXImport({
                fileHash,
                clientId: ensuredClientId,
                bankAccountId: summary.accountId,
                importedAt,
                transactionCount: summary.transactionCount,
                statementStart: summary.statementStart,
                statementEnd: summary.statementEnd,
              })
            )
          );

          return res.json({
            success: true,
            imported: 0,
            total: existingTransactions.length,
            message: "Nenhuma transação nova encontrada no arquivo OFX.",
            duplicateAccounts: Array.from(duplicateAccounts),
          });
        }

        await storage.addTransactions(ensuredClientId, transactions);

        const importedAt = new Date().toISOString();
        await Promise.all(
          accountSummaries.map(summary =>
            storage.addOFXImport({
              fileHash,
              clientId: ensuredClientId,
              bankAccountId: summary.accountId,
              importedAt,
              transactionCount: summary.transactionCount,
              statementStart: summary.statementStart,
              statementEnd: summary.statementEnd,
            })
          )
        );

        const totalTransactions = existingTransactions.length + transactions.length;

        res.json({
          success: true,
          imported: transactions.length,
          total: totalTransactions,
          message: `${transactions.length} transações importadas com sucesso.`,
          duplicateAccounts: Array.from(duplicateAccounts),
        });
      } catch (error) {
        getLogger(req).error(
          "Erro ao importar OFX",
          {
            event: "pf.ofx.import",
            context: { clientId: clientIdForLogging },
          },
          error
        );
        res.status(400).json({
          error: error instanceof Error ? error.message : "Erro ao importar arquivo OFX"
        });
      }
    }
  );

  // 3. GET /api/transactions/list - List transactions with filters
  app.get("/api/transactions/list", validateClientAccess, async (req, res) => {
    try {
      const client = req.clientContext;

      if (!client || !req.authUser) {
        return res.status(500).json({ error: "Contexto do cliente não carregado" });
      }

      const { status, from, to, category, clientId } = req.query;

      if (clientId && clientId !== client.clientId) {
        return res.status(400).json({ error: "clientId inconsistente com o contexto carregado" });
      }

      let transactions = await storage.getTransactions(client.clientId);

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
  app.post("/api/transactions/categorize", validateClientAccess, async (req, res) => {
    try {
      const parsedBody = categorizeSchema.parse(req.body);
      const client = req.clientContext;

      if (!client || !req.authUser) {
        return res.status(500).json({ error: "Contexto do cliente não carregado" });
      }

      const { indices, category, subcategory, clientId } = parsedBody;

      if (clientId && clientId !== client.clientId) {
        return res.status(400).json({ error: "clientId inconsistente com o contexto carregado" });
      }

      const transactions = await storage.getTransactions(client.clientId);

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

      await storage.setTransactions(client.clientId, transactions);
      res.json({ success: true, updated: indices.length });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Erro ao categorizar" });
    }
  });

  // 5. GET /api/summary - Get financial summary and KPIs
  app.get("/api/summary", validateClientAccess, async (req, res) => {
    try {
      const { clientId: requestedClientId, period } = req.query;
      const client = req.clientContext;

      if (!client || !req.authUser) {
        return res.status(500).json({ error: "Contexto do cliente não carregado" });
      }

      if (requestedClientId && requestedClientId !== client.clientId) {
        return res.status(400).json({ error: "clientId inconsistente com o contexto carregado" });
      }

      let transactions = await storage.getTransactions(client.clientId);

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
        const positions = await storage.getPositions(client.clientId);
        const policy = await storage.getPolicy(client.clientId);

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
  app.get("/api/investments/positions", validateClientAccess, async (req, res) => {
    try {
      const { clientId } = req.query;
      const client = req.clientContext;

      if (!client || !req.authUser) {
        return res.status(500).json({ error: "Contexto do cliente não carregado" });
      }

      if (clientId && clientId !== client.clientId) {
        return res.status(400).json({ error: "clientId inconsistente com o contexto carregado" });
      }

      const positions = await storage.getPositions(client.clientId);
      res.json(positions);
    } catch (error) {
      res.status(500).json({ error: "Erro ao buscar posições" });
    }
  });

  // POST /api/investments/positions - Add new position
  app.post(
    "/api/investments/positions",
    validateClientAccess,
    requireRole("master", "consultor"),
    async (req, res) => {
    try {
      const { clientId, position } = req.body;
      const client = req.clientContext;

      if (!client || !req.authUser) {
        return res.status(500).json({ error: "Contexto do cliente não carregado" });
      }

      if (clientId && clientId !== client.clientId) {
        return res.status(400).json({ error: "clientId inconsistente com o contexto carregado" });
      }

      await storage.addPosition(client.clientId, position);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: "Erro ao adicionar posição" });
    }
    }
  );

  // 7. POST /api/investments/rebalance/suggest - Suggest rebalancing
  app.post(
    "/api/investments/rebalance/suggest",
    validateClientAccess,
    requireRole("master", "consultor"),
    async (req, res) => {
    try {
      const { clientId } = req.body;
      const client = req.clientContext;

      if (!client || !req.authUser) {
        return res.status(500).json({ error: "Contexto do cliente não carregado" });
      }

      if (clientId && clientId !== client.clientId) {
        return res.status(400).json({ error: "clientId inconsistente com o contexto carregado" });
      }

      const positions = await storage.getPositions(client.clientId);
      const policy = await storage.getPolicy(client.clientId);
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
    }
  );

  // 8. POST /api/reports/generate - Generate monthly report
  app.post(
    "/api/reports/generate",
    validateClientAccess,
    requireRole("master", "consultor"),
    async (req, res) => {
    try {
      const { clientId, period, notes } = req.body;
      const client = req.clientContext;

      if (!client || !req.authUser || !period) {
        return res.status(400).json({ error: "Informe clientId e period." });
      }

      if (clientId && clientId !== client.clientId) {
        return res.status(400).json({ error: "clientId inconsistente com o contexto carregado" });
      }

      // Get summary for the period
      const transactions = (await storage.getTransactions(client.clientId)).filter((t) =>
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

      await storage.setReport(client.clientId, period, report);

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

      await storage.setReportHtml(client.clientId, period, html);
      res.json({ success: true, html });
    } catch (error) {
      res.status(500).json({ error: "Erro ao gerar relatório" });
    }
    }
  );

  // 9. GET /api/reports/view - View report
  app.get("/api/reports/view", validateClientAccess, async (req, res) => {
    try {
      const { clientId, period } = req.query;
      const client = req.clientContext;

      if (!client || !req.authUser || !clientId || !period) {
        return res.status(400).json({ error: "Informe clientId e period." });
      }

      if (clientId !== client.clientId) {
        return res.status(400).json({ error: "clientId inconsistente com o contexto carregado" });
      }

      let html = await storage.getReportHtml(client.clientId, period as string);

      // If no HTML found, try to generate on-the-fly
      if (!html) {
        const report = await storage.getReport(client.clientId, period as string);
        if (!report) {
          return res.status(404).json({ error: "Relatório não encontrado." });
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
  app.post(
    "/api/policies/upsert",
    validateClientAccess,
    requireRole("master", "consultor"),
    async (req, res) => {
      try {
      const { clientId, data } = req.body;
      const client = req.clientContext;

      if (!client || !req.authUser) {
        return res.status(500).json({ error: "Contexto do cliente não carregado" });
      }

        if (clientId && clientId !== client.clientId) {
          return res.status(400).json({ error: "clientId inconsistente com o contexto carregado" });
        }

        await storage.setPolicy(client.clientId, data);
        res.json({ success: true });
      } catch (error) {
        res.status(400).json({ error: "Erro ao atualizar políticas" });
      }
    }
  );

  // GET /api/policies - Get policies
  app.get("/api/policies", validateClientAccess, async (req, res) => {
    try {
      const { clientId } = req.query;
      const client = req.clientContext;

      if (!client || !req.authUser || !clientId) {
        return res.status(400).json({ error: "Informe o clientId." });
      }

      if (clientId !== client.clientId) {
        return res.status(400).json({ error: "clientId inconsistente com o contexto carregado" });
      }

      const policy = await storage.getPolicy(client.clientId);
      res.json(policy || {});
    } catch (error) {
      res.status(500).json({ error: "Erro ao buscar políticas" });
    }
  });

  const swaggerUi = await resolveSwaggerUi();

  if (swaggerUi) {
    // API Documentation endpoint
    app.use(
      "/api/docs",
      (_req: Request, res: Response, next: NextFunction) => {
        res.setHeader("Cache-Control", "private, max-age=60");
        next();
      },
      swaggerUi.serve,
      swaggerUi.setup(openApiSpec, { explorer: false })
    );
  } else {
    console.warn("Swagger UI não carregado; rota /api/docs desabilitada");
  }

  app.get("/api/openapi.json", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "private, max-age=60");
    res.json(openApiSpec);
  });

  // Register Open Finance routes
  registerOpenFinanceRoutes(app);
  
  // Register PJ routes
  registerPJRoutes(app);
  registerPjPlanRoutes(app);

  const httpServer = createServer(app);
  return httpServer;
}
