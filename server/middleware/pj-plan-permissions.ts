import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { getLogger } from "../observability/logger";
import { recordAuditEvent } from "../security/audit";
import type { User } from "@shared/schema";

const NOT_AUTHENTICATED_RESPONSE = { error: "Não autenticado" } as const;
const USER_NOT_FOUND_RESPONSE = { error: "Usuário não encontrado" } as const;
const ACCESS_DENIED_RESPONSE = { error: "Acesso negado" } as const;
const CLIENT_NOT_FOUND_RESPONSE = { error: "Cliente não encontrado" } as const;

type ClientIdResolver = (req: Request) => string | undefined | Promise<string | undefined>;

type PlanAccessDeniedEventType =
  | "security.access_denied.pj_plan_global"
  | "security.access_denied.pj_plan_client";

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

async function logPlanAccessDenied(
  req: Request,
  user: User,
  {
    eventType,
    targetType,
    targetId,
    metadata,
  }: {
    eventType: PlanAccessDeniedEventType;
    targetType: string;
    targetId?: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
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
      "Falha ao registrar auditoria de acesso negado ao plano PJ",
      {
        event: "audit.access_denied",
        context: { eventType, targetType, targetId },
      },
      error,
    );
  }
}

export async function requireMasterForGlobalPlan(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json(NOT_AUTHENTICATED_RESPONSE);
      return;
    }

    const user = await resolveRequestUser(req);
    if (!user) {
      res.status(401).json(USER_NOT_FOUND_RESPONSE);
      return;
    }

    if (user.role !== "master") {
      await logPlanAccessDenied(req, user, {
        eventType: "security.access_denied.pj_plan_global",
        targetType: "pj_plan",
        metadata: {
          reason: "master_role_required",
          userRole: user.role,
        },
      });
      res.status(403).json(ACCESS_DENIED_RESPONSE);
      return;
    }

    req.authUser = user;
    next();
  } catch (error) {
    getLogger(req).error(
      "Erro ao validar acesso ao plano PJ global",
      { event: "pj_plan.require_master" },
      error,
    );
    res.status(500).json({ error: "Erro ao validar permissões" });
  }
}

export function requireConsultantOrMaster(getClientId: ClientIdResolver) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        res.status(401).json(NOT_AUTHENTICATED_RESPONSE);
        return;
      }

      const resolvedUser = await resolveRequestUser(req);
      if (!resolvedUser) {
        res.status(401).json(USER_NOT_FOUND_RESPONSE);
        return;
      }

      const clientId = await getClientId(req);
      if (!clientId) {
        res.status(400).json({ error: "clientId é obrigatório" });
        return;
      }

      const client = await storage.getClient(clientId);
      if (!client) {
        res.status(404).json(CLIENT_NOT_FOUND_RESPONSE);
        return;
      }

      if (client.organizationId !== resolvedUser.organizationId) {
        await logPlanAccessDenied(req, resolvedUser, {
          eventType: "security.access_denied.pj_plan_client",
          targetType: "client",
          targetId: clientId,
          metadata: {
            clientId,
            reason: "organization_mismatch",
          },
        });
        res.status(404).json(CLIENT_NOT_FOUND_RESPONSE);
        return;
      }

      if (resolvedUser.role === "master") {
        req.authUser = resolvedUser;
        req.clientContext = client;
        next();
        return;
      }

      if (resolvedUser.role !== "consultor") {
        await logPlanAccessDenied(req, resolvedUser, {
          eventType: "security.access_denied.pj_plan_client",
          targetType: "client",
          targetId: clientId,
          metadata: {
            clientId,
            reason: "role_not_allowed",
            userRole: resolvedUser.role,
          },
        });
        res.status(403).json(ACCESS_DENIED_RESPONSE);
        return;
      }

      if (!resolvedUser.clientIds.includes(clientId)) {
        await logPlanAccessDenied(req, resolvedUser, {
          eventType: "security.access_denied.pj_plan_client",
          targetType: "client",
          targetId: clientId,
          metadata: {
            clientId,
            reason: "client_not_linked",
            userRole: resolvedUser.role,
          },
        });
        res.status(403).json(ACCESS_DENIED_RESPONSE);
        return;
      }

      req.authUser = resolvedUser;
      req.clientContext = client;
      next();
    } catch (error) {
      getLogger(req).error(
        "Erro ao validar acesso ao plano PJ do cliente",
        { event: "pj_plan.require_consultant_or_master" },
        error,
      );
      res.status(500).json({ error: "Erro ao validar permissões" });
    }
  };
}

