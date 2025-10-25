import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";

/**
 * Middleware de validação de scope (PF/PJ)
 * Garante isolamento total entre dados PF e PJ
 */
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

      // Buscar cliente
      const client = await storage.getClient(clientId);
      if (!client) {
        return res.status(404).json({ error: "Cliente não encontrado" });
      }

      // Validar scope do cliente
      if (client.type !== requiredScope && client.type !== "BOTH") {
        return res.status(403).json({ 
          error: `Esta operação é permitida apenas para clientes ${requiredScope}` 
        });
      }

      // Validar se usuário tem acesso a este cliente
      const user = await storage.getUserById(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "Usuário não encontrado" });
      }

      // Consultores só podem acessar seus clientes
      if (user.role === "consultor" && !user.clientIds.includes(clientId)) {
        return res.status(403).json({ error: "Acesso negado a este cliente" });
      }

      // Cliente só pode acessar seus próprios dados
      if (user.role === "cliente" && !user.clientIds.includes(clientId)) {
        return res.status(403).json({ error: "Acesso negado" });
      }

      // Anexar informações do cliente na request para uso posterior
      (req as any).client = client;
      (req as any).user = user;

      next();
    } catch (error) {
      console.error("Erro no middleware de scope:", error);
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
      return res.status(404).json({ error: "Cliente não encontrado" });
    }

    // Validar acesso do usuário
    const user = await storage.getUserById(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: "Usuário não encontrado" });
    }

    if (user.role === "consultor" && !user.clientIds.includes(clientId)) {
      return res.status(403).json({ error: "Acesso negado a este cliente" });
    }

    if (user.role === "cliente" && !user.clientIds.includes(clientId)) {
      return res.status(403).json({ error: "Acesso negado" });
    }

    // Anexar informações na request
    (req as any).client = client;
    (req as any).user = user;

    next();
  } catch (error) {
    console.error("Erro ao validar acesso ao cliente:", error);
    res.status(500).json({ error: "Erro ao validar permissões" });
  }
}
