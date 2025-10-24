import type { Request, Response, NextFunction } from "express";

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Skip auth for public routes (already handled before this middleware)
  if (req.path.startsWith("/api/auth")) {
    return next();
  }

  // Check if user is authenticated via session
  if (!req.session.userId) {
    return res.status(401).json({ error: "Não autenticado. Faça login para continuar." });
  }

  next();
}
