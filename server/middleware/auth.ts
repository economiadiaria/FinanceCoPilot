import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { getLogger, updateRequestLoggerContext } from "../observability/logger";

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Skip auth for public routes (already handled before this middleware)
  if (req.path.startsWith("/api/auth")) {
    return next();
  }

  // Check if user is authenticated via session
  if (!req.session.userId) {
    return res.status(401).json({ error: "Não autenticado. Faça login para continuar." });
  }

  storage.getUserById(req.session.userId)
    .then(user => {
      if (!user) {
        return res.status(401).json({ error: "Sessão inválida" });
      }
      req.authUser = user;
      updateRequestLoggerContext(req, { userId: user.userId });
      next();
    })
    .catch(error => {
      getLogger(req).error("Erro ao recuperar usuário da sessão", {
        event: "auth.session.lookup",
        context: { sessionUserId: req.session.userId },
      }, error);
      res.status(500).json({ error: "Erro ao validar sessão" });
    });
}
