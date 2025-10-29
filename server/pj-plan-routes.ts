import type { Express, Request, Response } from "express";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { authMiddleware } from "./middleware/auth";
import { validateClientAccess } from "./middleware/scope";
import {
  requireConsultantOrMaster,
  requireMasterForGlobalPlan,
} from "./middleware/rbac";
import { storage } from "./storage";
import { recordAuditEvent } from "./security/audit";
import { getLogger } from "./observability/logger";
import type { PjCategory } from "@shared/schema";

function sanitizeGlobalCategory(category: PjCategory) {
  return {
    id: category.id,
    code: category.code,
    name: category.name,
    description: category.description ?? null,
    parentId: category.parentId ?? null,
    acceptsPostings: category.acceptsPostings,
    level: category.level,
    path: category.path,
    sortOrder: category.sortOrder,
    isCore: category.isCore,
  };
}

function sanitizeClientCategory(category: import("./storage").PjClientCategoryRecord) {
  return {
    id: category.id,
    baseCategoryId: category.baseCategoryId,
    name: category.name,
    description: category.description ?? null,
    parentId: category.parentId,
    acceptsPostings: category.acceptsPostings,
    level: category.level,
    path: category.path,
    sortOrder: category.sortOrder,
  };
}

const globalCategoryCreateSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  parentId: z.string().optional().nullable(),
  acceptsPostings: z.boolean().optional(),
  sortOrder: z.number().optional(),
});

const globalCategoryUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  acceptsPostings: z.boolean().optional(),
  sortOrder: z.number().optional(),
});

const clientCategoryCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  parentId: z.string().optional().nullable(),
  acceptsPostings: z.boolean().optional(),
  baseCategoryId: z.string().optional().nullable(),
  sortOrder: z.number().optional(),
});

const clientCategoryUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  acceptsPostings: z.boolean().optional(),
  sortOrder: z.number().optional(),
});

function computeHierarchy(
  categories: PjCategory[],
  parentId: string | null | undefined,
) {
  if (!parentId) {
    return { level: 1, path: "" } as const;
  }

  const parent = categories.find(category => category.id === parentId);
  if (!parent) {
    throw new Error("Categoria pai não encontrada");
  }

  return {
    level: parent.level + 1,
    path: parent.path,
  } as const;
}

function computeClientHierarchy(
  categories: import("./storage").PjClientCategoryRecord[],
  parentId: string | null | undefined,
) {
  if (!parentId) {
    return { level: 0, path: "" } as const;
  }

  const parent = categories.find(category => category.id === parentId);
  if (!parent) {
    throw new Error("Categoria pai não encontrada");
  }

  return {
    level: parent.level + 1,
    path: parent.path,
  } as const;
}

export function registerPjPlanRoutes(app: Express): void {
  const globalPlanRouter = Router();
  globalPlanRouter.use(authMiddleware, requireMasterForGlobalPlan);

  globalPlanRouter.get("/", async (_req, res) => {
    const categories = await storage.getPjCategories();
    res.json({ categories });
  });

  globalPlanRouter.post("/", async (req, res) => {
    try {
      const payload = globalCategoryCreateSchema.parse(req.body);
      const now = new Date().toISOString();
      const categories = await storage.getPjCategories();

      if (categories.some(category => category.code === payload.code)) {
        return res.status(409).json({ error: "Código de categoria já existe" });
      }

      const { level, path } = computeHierarchy(categories, payload.parentId ?? null);
      const basePath = path ? `${path}.${payload.code}` : payload.code;

      const category: PjCategory = {
        id: randomUUID(),
        code: payload.code,
        name: payload.name,
        description: payload.description,
        parentId: payload.parentId ?? null,
        isCore: false,
        acceptsPostings: payload.acceptsPostings ?? true,
        level,
        path: basePath,
        sortOrder: payload.sortOrder ?? (categories.length + 1) * 10,
        createdAt: now,
        updatedAt: now,
      };

      await storage.setPjCategories([...categories, category]);

      await recordAuditEvent({
        user: req.authUser!,
        eventType: "pj.plan.global.update",
        targetType: "pj_category",
        targetId: category.id,
        metadata: {
          action: "create",
          new: sanitizeGlobalCategory(category),
        },
      });

      res.status(201).json({ category });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      getLogger(req).error("Erro ao criar categoria global", {
        event: "pj.plan.global.create",
      }, error);
      res.status(400).json({ error: message });
    }
  });

  globalPlanRouter.patch("/:categoryId", async (req, res) => {
    const logger = getLogger(req);
    const { categoryId } = req.params;

    try {
      const updates = globalCategoryUpdateSchema.parse(req.body);
      const categories = await storage.getPjCategories();
      const current = categories.find(category => category.id === categoryId);

      if (!current) {
        return res.status(404).json({ error: "Categoria não encontrada" });
      }

      if (current.isCore) {
        logger.warn("Tentativa de mutação em categoria global core bloqueada", {
          event: "pj.plan.global.blocked",
          categoryId,
          userId: req.authUser?.userId,
        });
        return res.status(403).json({ error: "Categorias núcleo não podem ser alteradas" });
      }

      let updatedLevel = current.level;
      let updatedPath = current.path;

      if (updates.parentId !== undefined) {
        const { level, path } = computeHierarchy(categories, updates.parentId);
        updatedLevel = level;
        updatedPath = path ? `${path}.${current.code}` : current.code;
      }

      const updatedCategory: PjCategory = {
        ...current,
        ...updates,
        parentId: updates.parentId ?? current.parentId,
        acceptsPostings: updates.acceptsPostings ?? current.acceptsPostings,
        level: updatedLevel,
        path: updatedPath,
        sortOrder: updates.sortOrder ?? current.sortOrder,
        updatedAt: new Date().toISOString(),
      };

      const merged = categories.map(category =>
        category.id === categoryId ? updatedCategory : category
      );

      await storage.setPjCategories(merged);

      await recordAuditEvent({
        user: req.authUser!,
        eventType: "pj.plan.global.update",
        targetType: "pj_category",
        targetId: categoryId,
        metadata: {
          action: "update",
          old: sanitizeGlobalCategory(current),
          new: sanitizeGlobalCategory(updatedCategory),
        },
      });

      res.json({ category: updatedCategory });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      getLogger(req).error("Erro ao atualizar categoria global", {
        event: "pj.plan.global.update_error",
        categoryId,
      }, error);
      res.status(400).json({ error: message });
    }
  });

  globalPlanRouter.delete("/:categoryId", async (req, res) => {
    const logger = getLogger(req);
    const { categoryId } = req.params;

    const categories = await storage.getPjCategories();
    const current = categories.find(category => category.id === categoryId);

    if (!current) {
      return res.status(404).json({ error: "Categoria não encontrada" });
    }

    if (current.isCore) {
      logger.warn("Tentativa de remoção de categoria core bloqueada", {
        event: "pj.plan.global.blocked",
        categoryId,
        userId: req.authUser?.userId,
      });
      return res.status(403).json({ error: "Categorias núcleo não podem ser removidas" });
    }

    const hasChildren = categories.some(category => category.parentId === categoryId);
    if (hasChildren) {
      return res.status(400).json({ error: "Categoria possui dependências" });
    }

    const remaining = categories.filter(category => category.id !== categoryId);
    await storage.setPjCategories(remaining);

    await recordAuditEvent({
      user: req.authUser!,
      eventType: "pj.plan.global.update",
      targetType: "pj_category",
      targetId: categoryId,
      metadata: {
        action: "delete",
        old: sanitizeGlobalCategory(current),
      },
    });

    res.status(204).send();
  });

  app.use("/api/pj/plan/global", globalPlanRouter);

  const clientPlanRouter = Router({ mergeParams: true });
  clientPlanRouter.use(authMiddleware, validateClientAccess, requireConsultantOrMaster);

  clientPlanRouter.get("/", async (req, res) => {
    const client = req.clientContext!;
    const categories = await storage.getPjClientCategories(client.organizationId, client.clientId);
    res.json({ categories });
  });

  clientPlanRouter.post("/", async (req, res) => {
    const client = req.clientContext!;

    try {
      const payload = clientCategoryCreateSchema.parse(req.body);
      const categories = await storage.getPjClientCategories(client.organizationId, client.clientId);
      const now = new Date().toISOString();

      const id = randomUUID();
      const { level, path } = computeClientHierarchy(categories, payload.parentId ?? null);
      const basePath = path ? `${path}.${id}` : id;

      const category = {
        id,
        orgId: client.organizationId,
        clientId: client.clientId,
        baseCategoryId: payload.baseCategoryId ?? null,
        name: payload.name,
        description: payload.description ?? null,
        parentId: payload.parentId ?? null,
        acceptsPostings: payload.acceptsPostings ?? true,
        level,
        path: basePath,
        sortOrder: payload.sortOrder ?? (categories.length + 1) * 10,
        createdAt: now,
        updatedAt: now,
      } satisfies import("./storage").PjClientCategoryRecord;

      await storage.setPjClientCategories(client.organizationId, client.clientId, [
        ...categories,
        category,
      ]);

      await recordAuditEvent({
        user: req.authUser!,
        eventType: "pj.plan.client.update",
        targetType: "pj_client_category",
        targetId: category.id,
        metadata: {
          action: "create",
          clientId: client.clientId,
          new: sanitizeClientCategory(category),
        },
      });

      res.status(201).json({ category });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      getLogger(req).error("Erro ao criar categoria do cliente", {
        event: "pj.plan.client.create",
        clientId: req.clientContext?.clientId,
      }, error);
      res.status(400).json({ error: message });
    }
  });

  clientPlanRouter.patch("/:categoryId", async (req: Request, res: Response) => {
    const client = req.clientContext!;
    const { categoryId } = req.params;
    const logger = getLogger(req);

    try {
      const updates = clientCategoryUpdateSchema.parse(req.body);
      const categories = await storage.getPjClientCategories(client.organizationId, client.clientId);
      const current = categories.find(category => category.id === categoryId);

      if (!current) {
        return res.status(404).json({ error: "Categoria não encontrada" });
      }

      if (current.baseCategoryId) {
        const baseCategories = await storage.getPjCategories();
        const base = baseCategories.find(category => category.id === current.baseCategoryId);
        if (base?.isCore) {
          logger.warn("Tentativa de mutação em categoria cliente núcleo bloqueada", {
            event: "pj.plan.client.blocked",
            categoryId,
            clientId: client.clientId,
            userId: req.authUser?.userId,
          });
          return res.status(403).json({ error: "Categorias núcleo não podem ser alteradas" });
        }
      }

      let updatedLevel = current.level;
      let updatedPath = current.path;

      if (updates.parentId !== undefined) {
        const { level, path } = computeClientHierarchy(categories, updates.parentId);
        updatedLevel = level;
        const nodeId = current.id;
        updatedPath = path ? `${path}.${nodeId}` : nodeId;
      }

      const updatedCategory: import("./storage").PjClientCategoryRecord = {
        ...current,
        ...updates,
        parentId: updates.parentId ?? current.parentId,
        acceptsPostings: updates.acceptsPostings ?? current.acceptsPostings,
        sortOrder: updates.sortOrder ?? current.sortOrder,
        level: updatedLevel,
        path: updatedPath,
        updatedAt: new Date().toISOString(),
      };

      const merged = categories.map(category =>
        category.id === categoryId ? updatedCategory : category
      );

      await storage.setPjClientCategories(client.organizationId, client.clientId, merged);

      await recordAuditEvent({
        user: req.authUser!,
        eventType: "pj.plan.client.update",
        targetType: "pj_client_category",
        targetId: categoryId,
        metadata: {
          action: "update",
          clientId: client.clientId,
          old: sanitizeClientCategory(current),
          new: sanitizeClientCategory(updatedCategory),
        },
      });

      res.json({ category: updatedCategory });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      getLogger(req).error("Erro ao atualizar categoria do cliente", {
        event: "pj.plan.client.update_error",
        clientId: req.clientContext?.clientId,
        categoryId,
      }, error);
      res.status(400).json({ error: message });
    }
  });

  clientPlanRouter.delete("/:categoryId", async (req, res) => {
    const client = req.clientContext!;
    const { categoryId } = req.params;
    const logger = getLogger(req);

    const categories = await storage.getPjClientCategories(client.organizationId, client.clientId);
    const current = categories.find(category => category.id === categoryId);

    if (!current) {
      return res.status(404).json({ error: "Categoria não encontrada" });
    }

    if (current.baseCategoryId) {
      const baseCategories = await storage.getPjCategories();
      const base = baseCategories.find(category => category.id === current.baseCategoryId);
      if (base?.isCore) {
        logger.warn("Tentativa de remoção de categoria cliente núcleo bloqueada", {
          event: "pj.plan.client.blocked",
          categoryId,
          clientId: client.clientId,
          userId: req.authUser?.userId,
        });
        return res.status(403).json({ error: "Categorias núcleo não podem ser removidas" });
      }
    }

    const hasChildren = categories.some(category => category.parentId === categoryId);
    if (hasChildren) {
      return res.status(400).json({ error: "Categoria possui dependências" });
    }

    const remaining = categories.filter(category => category.id !== categoryId);
    await storage.setPjClientCategories(client.organizationId, client.clientId, remaining);

    await recordAuditEvent({
      user: req.authUser!,
      eventType: "pj.plan.client.update",
      targetType: "pj_client_category",
      targetId: categoryId,
      metadata: {
        action: "delete",
        clientId: client.clientId,
        old: sanitizeClientCategory(current),
      },
    });

    res.status(204).send();
  });

  app.use("/api/pj/plan/client/:clientId", clientPlanRouter);
}
