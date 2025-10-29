import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { getLogger, updateRequestLoggerContext } from "../observability/logger";
import { recordAuditEvent } from "../security/audit";
import type { BankAccount, User } from "@shared/schema";

/**
 * Middleware de validação de scope (PF/PJ)
 * Garante isolamento total entre dados PF e PJ
 */
const CLIENT_NOT_FOUND_RESPONSE = { error: "Cliente não encontrado" } as const;
const ACCESS_DENIED_RESPONSE = { error: "Acesso negado" } as const;
const BANK_ACCOUNT_NOT_FOUND_RESPONSE = { error: "Conta bancária não encontrada" } as const;

type AccessDeniedEventType =
  | "security.access_denied.organization"
  | "security.access_denied.client_link"
  | "security.access_denied.bank_account";

async function resolveRequestUser(req: Request): Promise<User | undefined> {
  if (req.authUser) {
    return req.authUser;
  }

  const userId = req.session?.userId;
  if (!userId) {
    return undefined;
  }

  return storage.getUserById(userId);
}

async function logAccessDeniedAudit(
  req: Request,
  user: User | undefined,
  {
    eventType,
    targetType,
    targetId,
    metadata,
  }: {
    eventType: AccessDeniedEventType;
    targetType: string;
    targetId?: string;
    metadata: Record<string, unknown>;
  }
): Promise<void> {
  if (!user) {
    return;
  }

  try {
    await recordAuditEvent({
      user,
      eventType,
      targetType,
      targetId,
      metadata,
    });
  } catch (error) {
    getLogger(req).error(
      "Falha ao registrar auditoria de acesso negado",
      {
        event: "audit.access_denied",
        context: { eventType, targetType, targetId },
      },
      error
    );
  }
}

export function scopeRequired(requiredScope: "PF" | "PJ") {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Verificar se está autenticado
      if (!req.session.userId) {
        return res.status(401).json({ error: "Não autenticado" });
      }

      // Obter clientId da query ou body
      const clientId = req.query.clientId as string || req.body?.clientId;
      
      if (!clientId) {
        return res.status(400).json({ error: "clientId é obrigatório" });
      }

      const client = await storage.getClient(clientId);
      if (!client) {
        return res.status(404).json(CLIENT_NOT_FOUND_RESPONSE);
      }

      // Validar scope do cliente
      if (client.type !== requiredScope && client.type !== "BOTH") {
        return res.status(403).json(ACCESS_DENIED_RESPONSE);
      }

      const user = req.authUser ?? (await storage.getUserById(req.session.userId));
      if (!user) {
        return res.status(401).json({ error: "Usuário não encontrado" });
      }

      if (client.organizationId !== user.organizationId) {
        await logAccessDeniedAudit(req, user, {
          eventType: "security.access_denied.organization",
          targetType: "client",
          targetId: clientId,
          metadata: {
            clientId,
            reason: "organization_mismatch",
            requiredScope,
          },
        });
        return res.status(404).json(CLIENT_NOT_FOUND_RESPONSE);
      }

      // Consultores só podem acessar seus clientes
      if (user.role === "consultor" && !user.clientIds.includes(clientId)) {
        await logAccessDeniedAudit(req, user, {
          eventType: "security.access_denied.client_link",
          targetType: "client",
          targetId: clientId,
          metadata: {
            clientId,
            reason: "client_not_linked",
            userRole: user.role,
          },
        });
        return res.status(403).json(ACCESS_DENIED_RESPONSE);
      }

      // Cliente só pode acessar seus próprios dados
      if (user.role === "cliente" && !user.clientIds.includes(clientId)) {
        await logAccessDeniedAudit(req, user, {
          eventType: "security.access_denied.client_link",
          targetType: "client",
          targetId: clientId,
          metadata: {
            clientId,
            reason: "client_not_linked",
            userRole: user.role,
          },
        });
        return res.status(403).json(ACCESS_DENIED_RESPONSE);
      }

      // Anexar informações do cliente na request para uso posterior
      req.clientContext = client;
      req.authUser = user;

      next();
    } catch (error) {
      getLogger(req).error("Erro no middleware de scope", {
        event: "scope.validation",
        context: { requiredScope },
      }, error);
      res.status(500).json({ error: "Erro ao validar permissões" });
    }
  };
}

/**
 * Middleware simplificado que apenas verifica autenticação
 * mas permite acesso a qualquer tipo de cliente
 */
export async function validateClientAccess(req: Request, res: Response, next: NextFunction) {
  try {
    // Verificar se está autenticado
    if (!req.session.userId) {
      return res.status(401).json({ error: "Não autenticado" });
    }

    // Obter clientId
    const clientId = req.query.clientId as string || req.body?.clientId || req.params.clientId;
    
    if (!clientId) {
      return res.status(400).json({ error: "clientId é obrigatório" });
    }

    // Buscar cliente
    const client = await storage.getClient(clientId);
    if (!client) {
      return res.status(404).json(CLIENT_NOT_FOUND_RESPONSE);
    }

    // Validar acesso do usuário
    const user = req.authUser ?? (await storage.getUserById(req.session.userId));
    if (!user) {
      return res.status(401).json({ error: "Usuário não encontrado" });
    }

    if (client.organizationId !== user.organizationId) {
      await logAccessDeniedAudit(req, user, {
        eventType: "security.access_denied.organization",
        targetType: "client",
        targetId: clientId,
        metadata: {
          clientId,
          reason: "organization_mismatch",
        },
      });
      return res.status(404).json(CLIENT_NOT_FOUND_RESPONSE);
    }

    if (user.role === "consultor" && !user.clientIds.includes(clientId)) {
      await logAccessDeniedAudit(req, user, {
        eventType: "security.access_denied.client_link",
        targetType: "client",
        targetId: clientId,
        metadata: {
          clientId,
          reason: "client_not_linked",
          userRole: user.role,
        },
      });
      return res.status(403).json(ACCESS_DENIED_RESPONSE);
    }

    if (user.role === "cliente" && !user.clientIds.includes(clientId)) {
      await logAccessDeniedAudit(req, user, {
        eventType: "security.access_denied.client_link",
        targetType: "client",
        targetId: clientId,
        metadata: {
          clientId,
          reason: "client_not_linked",
          userRole: user.role,
        },
      });
      return res.status(403).json(ACCESS_DENIED_RESPONSE);
    }

    // Anexar informações na request
    req.clientContext = client;
    req.authUser = user;

    next();
  } catch (error) {
    getLogger(req).error("Erro ao validar acesso ao cliente", {
      event: "scope.access",
    }, error);
    res.status(500).json({ error: "Erro ao validar permissões" });
  }
}

export async function ensureBankAccountAccess(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const client = req.clientContext;
    if (!client) {
      return res.status(500).json({ error: "Contexto do cliente não carregado" });
    }

    const candidate =
      req.query.bankAccountId ?? req.body?.bankAccountId ?? req.params?.bankAccountId;

    const bankAccountId = Array.isArray(candidate) ? candidate[0] : candidate;

    if (!bankAccountId || typeof bankAccountId !== "string") {
      return res.status(400).json({ error: "bankAccountId é obrigatório" });
    }

    const orgId = client.organizationId;
    const clientId = client.clientId;

    const accountsForClient = await storage.getBankAccounts(orgId, clientId);
    const matchedAccount = accountsForClient.find(
      (account: BankAccount) => account.id === bankAccountId
    );

    if (matchedAccount) {
      req.bankAccountContext = matchedAccount;
      updateRequestLoggerContext(req, { bankAccountId: matchedAccount.id });
      return next();
    }

    const accountsForOrg = await storage.getBankAccounts(orgId);
    const accountInOrg = accountsForOrg.find(
      (account: BankAccount) => account.id === bankAccountId
    );

    if (accountInOrg) {
      const user = await resolveRequestUser(req);
      await logAccessDeniedAudit(req, user, {
        eventType: "security.access_denied.bank_account",
        targetType: "bank_account",
        targetId: bankAccountId,
        metadata: {
          clientId,
          bankAccountId,
          reason: "bank_account_not_linked",
        },
      });
      return res.status(404).json(BANK_ACCOUNT_NOT_FOUND_RESPONSE);
    }

    {
      const user = await resolveRequestUser(req);
      await logAccessDeniedAudit(req, user, {
        eventType: "security.access_denied.bank_account",
        targetType: "bank_account",
        targetId: bankAccountId,
        metadata: {
          clientId,
          bankAccountId,
          reason: "bank_account_not_found",
        },
      });
    }

    return res.status(404).json(BANK_ACCOUNT_NOT_FOUND_RESPONSE);
  } catch (error) {
    getLogger(req).error(
      "Erro ao validar acesso à conta bancária",
      {
        event: "scope.bankAccount",
        context: {
          bankAccountId:
            (Array.isArray(req.query.bankAccountId)
              ? req.query.bankAccountId[0]
              : req.query.bankAccountId) ?? req.body?.bankAccountId ?? req.params?.bankAccountId,
        },
      },
      error
    );
    return res.status(500).json({ error: "Erro ao validar conta bancária" });
  }
}
