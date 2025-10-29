import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { type User } from "@shared/schema";

type Role = User["role"];

async function resolveRequestUser(req: Request): Promise<User | undefined> {
  if (req.authUser) {
    return req.authUser;
  }

  if (!req.session?.userId) {
    return undefined;
  }

  return storage.getUserById(req.session.userId);
}

export function requireRole(...allowedRoles: Role[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Não autenticado" });
    }

    try {
      const user = await resolveRequestUser(req);
      if (!user) {
        return res.status(401).json({ error: "Usuário não encontrado" });
      }

      if (!allowedRoles.includes(user.role)) {
        return res.status(403).json({ error: "Acesso negado" });
      }

      req.authUser = user;
      next();
    } catch (error) {
      console.error("Erro ao validar permissões:", error);
      res.status(500).json({ error: "Erro ao validar permissões" });
    }
  };
}

export function requireMasterForGlobalPlan(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Não autenticado" });
  }

  resolveRequestUser(req)
    .then(user => {
      if (!user) {
        return res.status(401).json({ error: "Usuário não encontrado" });
      }

      if (user.role !== "master") {
        return res.status(403).json({ error: "Apenas usuários master podem alterar o plano global" });
      }

      req.authUser = user;
      next();
    })
    .catch(error => {
      console.error("Erro ao validar permissões do plano global:", error);
      res.status(500).json({ error: "Erro ao validar permissões" });
    });
}

export async function requireConsultantOrMaster(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Não autenticado" });
  }

  try {
    const user = await resolveRequestUser(req);
    if (!user) {
      return res.status(401).json({ error: "Usuário não encontrado" });
    }

    if (user.role !== "consultor" && user.role !== "master") {
      return res.status(403).json({ error: "Apenas consultores ou masters podem alterar o plano do cliente" });
    }

    req.authUser = user;
    next();
  } catch (error) {
    console.error("Erro ao validar permissões do plano do cliente:", error);
    res.status(500).json({ error: "Erro ao validar permissões" });
  }
}
