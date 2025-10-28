import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { type User } from "@shared/schema";
import { getLogger, updateRequestLoggerContext } from "../observability/logger";

type Role = User["role"];

export function requireRole(...allowedRoles: Role[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Não autenticado" });
    }

    try {
      const user = req.authUser ?? (await storage.getUserById(req.session.userId));
      if (!user) {
        return res.status(401).json({ error: "Usuário não encontrado" });
      }

      if (!allowedRoles.includes(user.role)) {
        return res.status(403).json({ error: "Acesso negado" });
      }

      req.authUser = user;
      updateRequestLoggerContext(req, { userId: user.userId });
      next();
    } catch (error) {
      getLogger(req).error("Erro ao validar permissões", {
        event: "rbac.denied",
        context: { allowedRoles },
      }, error);
      res.status(500).json({ error: "Erro ao validar permissões" });
    }
  };
}
