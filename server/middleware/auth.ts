import type { Request, Response, NextFunction } from "express";

const API_KEY = process.env.APP_KEY || "demo-key-123";

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const providedKey = req.headers["x-api-key"];

  if (!providedKey || providedKey !== API_KEY) {
    return res.status(401).json({ error: "Chave inválida." });
  }

  next();
}
