import type { Express, Request, Response } from "express";
import { Router } from "express";
import { randomUUID } from "node:crypto";

import { authMiddleware } from "./middleware/auth";
import { validateClientAccess } from "./middleware/scope";
import {
  requireConsultantOrMaster,
  requireMasterForGlobalPlan,
} from "./middleware/rbac";
import { storage } from "./storage";
import { recordAuditEvent } from "./security/audit";
import { getLogger } from "./observability/logger";
import {
  pjClientCategoryCreateSchema,
  pjClientCategoryUpdateSchema,
  pjGlobalCategoryCreateSchema,
  pjGlobalCategoryUpdateSchema,
  pjPlanAuditEvents,
  type PjCategory,
} from "@shared/schema";
import {
  assertNoCategoryCycle,
  buildCategoryTree,
  computeClientHierarchy,
  computeGlobalHierarchy,
  sanitizeClientCategory,
  sanitizeGlobalCategory,
} from "./pj-category-service";

export function registerPjPlanRoutes(app: Express): void {
  const globalPlanRouter = Router();
  globalPlanRouter.use(authMiddleware, requireMasterForGlobalPlan);

  globalPlanRouter.get("/", async (_req, res) => {
    const categories = await storage.getPjCategories();
    const tree = buildCategoryTree(categories, sanitizeGlobalCategory);
    res.json({ type: "global", categories: tree });
  });

  globalPlanRouter.post("/", async (req, res) => {
    try {
      const payload = pjGlobalCategoryCreateSchema.parse(req.body);
      const now = new Date().toISOString();
      const categories = await storage.getPjCategories();

      if (categories.some(category => category.code === payload.code)) {
        return res.status(409).json({ error: "Código de categoria já existe" });
      }

      const { level, path } = computeGlobalHierarchy(categories, payload.parentId ?? null);
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

      const sanitizedCategory = sanitizeGlobalCategory(category);

      await recordAuditEvent({
        user: req.authUser!,
        eventType: pjPlanAuditEvents.global.create,
        targetType: "pj_category",
        targetId: category.id,
        metadata: {
          action: "create",
          new: sanitizedCategory,
        },
      });

      res.status(201).json({ category: sanitizedCategory });
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
      const updates = pjGlobalCategoryUpdateSchema.parse(req.body);
      const categories = await storage.getPjCategories();
      const current = categories.find(category => category.id === categoryId);

      if (!current) {
        return res.status(404).json({ error: "Categoria não encontrada" });
      }

      if (current.isCore) {
        logger.warn("Tentativa de mutação em categoria global core bloqueada", {
          event: "pj.plan.global.blocked",
          userId: req.authUser?.userId,
          context: { categoryId },
        });
        return res.status(403).json({ error: "Categorias núcleo não podem ser alteradas" });
      }

      const sanitizedBefore = sanitizeGlobalCategory(current);

      let updatedLevel = current.level;
      let updatedPath = current.path;

      if (updates.parentId !== undefined) {
        const ancestryView = categories.map(category => ({
          id: category.id,
          parentId: category.parentId ?? null,
        }));
        assertNoCategoryCycle(ancestryView, categoryId, updates.parentId ?? null);
        const { level, path } = computeGlobalHierarchy(categories, updates.parentId);
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

      const sanitizedAfter = sanitizeGlobalCategory(updatedCategory);

      await recordAuditEvent({
        user: req.authUser!,
        eventType: pjPlanAuditEvents.global.update,
        targetType: "pj_category",
        targetId: categoryId,
        metadata: {
          action: "update",
          old: sanitizedBefore,
          new: sanitizedAfter,
        },
      });

      res.json({ category: sanitizedAfter });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      getLogger(req).error("Erro ao atualizar categoria global", {
        event: "pj.plan.global.update_error",
        context: { categoryId },
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
        userId: req.authUser?.userId,
        context: { categoryId },
      });
      return res.status(403).json({ error: "Categorias núcleo não podem ser removidas" });
    }

    const hasChildren = categories.some(category => category.parentId === categoryId);
    if (hasChildren) {
      return res.status(400).json({ error: "Categoria possui dependências" });
    }

    const remaining = categories.filter(category => category.id !== categoryId);
    await storage.setPjCategories(remaining);

    const sanitizedCurrent = sanitizeGlobalCategory(current);

    await recordAuditEvent({
      user: req.authUser!,
      eventType: pjPlanAuditEvents.global.delete,
      targetType: "pj_category",
      targetId: categoryId,
      metadata: {
        action: "delete",
        old: sanitizedCurrent,
      },
    });

    res.status(204).send();
  });

  app.use("/api/pj/plan/global", globalPlanRouter);

  const clientPlanRouter = Router({ mergeParams: true });
  clientPlanRouter.use(authMiddleware, validateClientAccess, requireConsultantOrMaster);

  clientPlanRouter.get("/", async (req, res) => {
    const client = req.clientContext!;
    const categories = (await storage.getPjClientCategories(
      client.organizationId,
      client.clientId,
    )) as import("./storage").PjClientCategoryRecord[];
    const tree = buildCategoryTree(categories, sanitizeClientCategory);
    res.json({ type: "client", categories: tree });
  });

  clientPlanRouter.post("/", async (req, res) => {
    const client = req.clientContext!;

    try {
      const payload = pjClientCategoryCreateSchema.parse(req.body);
      const categories = (await storage.getPjClientCategories(
        client.organizationId,
        client.clientId,
      )) as import("./storage").PjClientCategoryRecord[];
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

      const sanitizedCategory = sanitizeClientCategory(category);

      await recordAuditEvent({
        user: req.authUser!,
        eventType: pjPlanAuditEvents.client.create,
        targetType: "pj_client_category",
        targetId: category.id,
        metadata: {
          action: "create",
          clientId: client.clientId,
          new: sanitizedCategory,
        },
      });

      res.status(201).json({ category: sanitizedCategory });
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
      const updates = pjClientCategoryUpdateSchema.parse(req.body);
      const categories = (await storage.getPjClientCategories(
        client.organizationId,
        client.clientId,
      )) as import("./storage").PjClientCategoryRecord[];
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
            clientId: client.clientId,
            userId: req.authUser?.userId,
            context: { categoryId },
          });
          return res.status(403).json({ error: "Categorias núcleo não podem ser alteradas" });
        }
      }

      const sanitizedBefore = sanitizeClientCategory(current);

      let updatedLevel = current.level;
      let updatedPath = current.path;

      if (updates.parentId !== undefined) {
        const ancestryView = categories.map(category => ({
          id: category.id,
          parentId: category.parentId ?? null,
        }));
        assertNoCategoryCycle(ancestryView, categoryId, updates.parentId ?? null);
        const { level, path } = computeClientHierarchy(categories, updates.parentId);
        updatedLevel = level;
        const nodeId = current.id;
        updatedPath = path ? `${path}.${nodeId}` : nodeId;
      }

      const updatedCategory: import("./storage").PjClientCategoryRecord = {
        ...current,
        ...updates,
        parentId: updates.parentId ?? current.parentId ?? null,
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

      const sanitizedAfter = sanitizeClientCategory(updatedCategory);

      await recordAuditEvent({
        user: req.authUser!,
        eventType: pjPlanAuditEvents.client.update,
        targetType: "pj_client_category",
        targetId: categoryId,
        metadata: {
          action: "update",
          clientId: client.clientId,
          old: sanitizedBefore,
          new: sanitizedAfter,
        },
      });

      res.json({ category: sanitizedAfter });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      getLogger(req).error("Erro ao atualizar categoria do cliente", {
        event: "pj.plan.client.update_error",
        clientId: req.clientContext?.clientId,
        context: { categoryId },
      }, error);
      res.status(400).json({ error: message });
    }
  });

  clientPlanRouter.delete("/:categoryId", async (req, res) => {
    const client = req.clientContext!;
    const { categoryId } = req.params;
    const logger = getLogger(req);

    const categories = (await storage.getPjClientCategories(
      client.organizationId,
      client.clientId,
    )) as import("./storage").PjClientCategoryRecord[];
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
          clientId: client.clientId,
          userId: req.authUser?.userId,
          context: { categoryId },
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

    const sanitizedCurrent = sanitizeClientCategory(current);

    await recordAuditEvent({
      user: req.authUser!,
      eventType: pjPlanAuditEvents.client.delete,
      targetType: "pj_client_category",
      targetId: categoryId,
      metadata: {
        action: "delete",
        clientId: client.clientId,
        old: sanitizedCurrent,
      },
    });

    res.status(204).send();
  });

  app.use("/api/pj/plan/client/:clientId", clientPlanRouter);
}
