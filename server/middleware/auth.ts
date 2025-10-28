import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Skip auth for public routes (already handled before this middleware)
  const requestPath = `${req.baseUrl}${req.path}`;

  if (requestPath.startsWith("/api/auth") || requestPath === "/api/openfinance/webhook") {
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
      next();
    })
    .catch(error => {
      console.error("Erro ao recuperar usuário da sessão:", error);
      res.status(500).json({ error: "Erro ao validar sessão" });
    });
}
