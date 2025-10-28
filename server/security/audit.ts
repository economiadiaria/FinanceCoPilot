import { v4 as uuid } from "uuid";
import { storage } from "../storage";
import { scrubPII, maskPIIValue } from "@shared/utils";
import type { AuditLogEntry, User } from "@shared/schema";
import { auditEventTypes } from "@shared/schema";

type AuditEvent = (typeof auditEventTypes)[number];

type AuditParams = {
  user: User;
  eventType: AuditEvent;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  piiSnapshot?: Record<string, unknown>;
};

export async function recordAuditEvent({
  user,
  eventType,
  targetType,
  targetId,
  metadata = {},
  piiSnapshot,
}: AuditParams): Promise<void> {
  const maskedMetadata = scrubPII(metadata);
  const maskedPiiSnapshot = piiSnapshot
    ? Object.entries(piiSnapshot).reduce<Record<string, string>>((acc, [key, value]) => {
        acc[key] = String(maskPIIValue(key, value));
        return acc;
      }, {})
    : undefined;

  const entry: AuditLogEntry = {
    auditId: uuid(),
    organizationId: user.organizationId,
    userId: user.userId,
    actorRole: user.role,
    eventType,
    targetType,
    targetId,
    createdAt: new Date().toISOString(),
    metadata: maskedMetadata,
    piiSnapshot: maskedPiiSnapshot,
  };

  await storage.recordAudit(entry);
}

export async function listAuditLogs(user: User, limit = 100): Promise<AuditLogEntry[]> {
  return storage.getAuditLogs(user.organizationId, limit);
}
