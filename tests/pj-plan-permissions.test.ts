import { describe, beforeEach, it } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response, NextFunction } from "express";
import { MemStorage, setStorageProvider } from "../server/storage";
import {
  requireMasterForGlobalPlan,
  requireConsultantOrMaster,
} from "../server/middleware/pj-plan-permissions";
import type { Client, User } from "@shared/schema";

function createRequest(userId?: string): Request {
  return {
    session: { userId } as any,
    body: {},
    params: {},
    query: {},
  } as Request;
}

function createMockResponse() {
  let statusCode = 200;
  let payload: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      payload = body;
      return this;
    },
  } as unknown as Response;

  return {
    res,
    getStatus: () => statusCode,
    getPayload: () => payload,
  };
}

function createNext() {
  let called = false;
  const next: NextFunction = () => {
    called = true;
  };

  return {
    next,
    wasCalled: () => called,
  };
}

describe("PJ plan permission middlewares", () => {
  let storageProvider: MemStorage;
  let masterUser: User;
  let consultantLinked: User;
  let consultantUnlinked: User;
  let clientUser: User;
  let planClient: Client;

  beforeEach(async () => {
    storageProvider = setStorageProvider(new MemStorage());

    masterUser = {
      userId: "master-1",
      email: "master@example.com",
      passwordHash: "hash-master",
      role: "master",
      name: "Master Org",
      organizationId: "org-1",
      clientIds: [],
      managedConsultantIds: ["consultant-1", "consultant-2"],
      managedClientIds: ["client-1"],
    };

    consultantLinked = {
      userId: "consultant-1",
      email: "consultant-linked@example.com",
      passwordHash: "hash-consultant",
      role: "consultor",
      name: "Consultant Linked",
      organizationId: "org-1",
      clientIds: ["client-1"],
      managedConsultantIds: [],
      managedClientIds: [],
      managerId: masterUser.userId,
    };

    consultantUnlinked = {
      userId: "consultant-2",
      email: "consultant-unlinked@example.com",
      passwordHash: "hash-consultant",
      role: "consultor",
      name: "Consultant Unlinked",
      organizationId: "org-1",
      clientIds: [],
      managedConsultantIds: [],
      managedClientIds: [],
      managerId: masterUser.userId,
    };

    clientUser = {
      userId: "client-user",
      email: "client@example.com",
      passwordHash: "hash-client",
      role: "cliente",
      name: "Cliente PJ",
      organizationId: "org-1",
      clientIds: ["client-1"],
      managedConsultantIds: [],
      managedClientIds: [],
      consultantId: consultantLinked.userId,
      managerId: masterUser.userId,
    };

    planClient = {
      clientId: "client-1",
      name: "Empresa 1",
      type: "PJ",
      email: "empresa1@example.com",
      organizationId: "org-1",
      consultantId: consultantLinked.userId,
      masterId: masterUser.userId,
    };

    await storageProvider.createUser(masterUser);
    await storageProvider.createUser(consultantLinked);
    await storageProvider.createUser(consultantUnlinked);
    await storageProvider.createUser(clientUser);
    await storageProvider.upsertClient(planClient);
  });

  it("allows masters to access the global PJ plan", async () => {
    const req = createRequest(masterUser.userId);
    const { res, getStatus } = createMockResponse();
    const { next, wasCalled } = createNext();

    await requireMasterForGlobalPlan(req, res, next);

    assert.equal(wasCalled(), true, "next() should be called for master users");
    const enrichedReq = req as Request & { authUser?: User };
    assert.equal(enrichedReq.authUser?.userId, masterUser.userId);
    assert.equal(getStatus(), 200);
  });

  it("denies global PJ plan access for non-master users and audits the attempt", async () => {
    const req = createRequest(consultantLinked.userId);
    const { res, getStatus, getPayload } = createMockResponse();
    const { next, wasCalled } = createNext();

    await requireMasterForGlobalPlan(req, res, next);

    assert.equal(wasCalled(), false, "next() should not be called for consultants");
    assert.equal(getStatus(), 403);
    assert.deepEqual(getPayload(), { error: "Acesso negado" });

    const auditLogs = await storageProvider.getAuditLogs("org-1");
    const denial = auditLogs.find((entry) => entry.eventType === "security.access_denied.pj_plan_global");
    assert.ok(denial, "expected access denial to be audited");
    assert.equal(denial?.targetType, "pj_plan");
    const metadata = denial?.metadata as Record<string, unknown> | undefined;
    assert.equal(metadata?.reason, "master_role_required");
    assert.equal(metadata?.userRole, "consultor");
  });

  it("allows masters to access client PJ plans", async () => {
    const middleware = requireConsultantOrMaster(() => planClient.clientId);
    const req = createRequest(masterUser.userId);
    const { res, getStatus } = createMockResponse();
    const { next, wasCalled } = createNext();

    await middleware(req, res, next);

    assert.equal(wasCalled(), true, "next() should be called for master users");
    const enrichedReq = req as Request & { authUser?: User; clientContext?: Client };
    assert.equal(enrichedReq.authUser?.userId, masterUser.userId);
    assert.equal(enrichedReq.clientContext?.clientId, planClient.clientId);
    assert.equal(getStatus(), 200);
  });

  it("allows linked consultants to access client PJ plans", async () => {
    const middleware = requireConsultantOrMaster(() => planClient.clientId);
    const req = createRequest(consultantLinked.userId);
    const { res, getStatus } = createMockResponse();
    const { next, wasCalled } = createNext();

    await middleware(req, res, next);

    assert.equal(wasCalled(), true, "linked consultants should pass the middleware");
    const enrichedReq = req as Request & { authUser?: User; clientContext?: Client };
    assert.equal(enrichedReq.authUser?.userId, consultantLinked.userId);
    assert.equal(enrichedReq.clientContext?.clientId, planClient.clientId);
    assert.equal(getStatus(), 200);
  });

  it("denies consultants without client links and records the audit trail", async () => {
    const middleware = requireConsultantOrMaster(() => planClient.clientId);
    const req = createRequest(consultantUnlinked.userId);
    const { res, getStatus, getPayload } = createMockResponse();
    const { next, wasCalled } = createNext();

    await middleware(req, res, next);

    assert.equal(wasCalled(), false, "unlinked consultants should be blocked");
    assert.equal(getStatus(), 403);
    assert.deepEqual(getPayload(), { error: "Acesso negado" });

    const auditLogs = await storageProvider.getAuditLogs("org-1");
    const denial = auditLogs.find((entry) => entry.eventType === "security.access_denied.pj_plan_client");
    assert.ok(denial, "expected client plan denial to be audited");
    assert.equal(denial?.targetType, "client");
    assert.equal(denial?.targetId, planClient.clientId);
    const metadata = denial?.metadata as Record<string, unknown> | undefined;
    assert.equal(metadata?.reason, "client_not_linked");
    assert.equal(metadata?.userRole, "consultor");
  });

  it("denies PJ client users and captures the audit event", async () => {
    const middleware = requireConsultantOrMaster(() => planClient.clientId);
    const req = createRequest(clientUser.userId);
    const { res, getStatus, getPayload } = createMockResponse();
    const { next, wasCalled } = createNext();

    await middleware(req, res, next);

    assert.equal(wasCalled(), false, "PJ clients should not bypass the middleware");
    assert.equal(getStatus(), 403);
    assert.deepEqual(getPayload(), { error: "Acesso negado" });

    const auditLogs = await storageProvider.getAuditLogs("org-1");
    const denial = auditLogs.find((entry) => entry.eventType === "security.access_denied.pj_plan_client");
    assert.ok(denial, "expected PJ client denial to be audited");
    assert.equal(denial?.targetType, "client");
    assert.equal(denial?.targetId, planClient.clientId);
    const metadata = denial?.metadata as Record<string, unknown> | undefined;
    assert.equal(metadata?.reason, "role_not_allowed");
    assert.equal(metadata?.userRole, "cliente");
  });
});

