import { v4 as uuid } from "uuid";
import { storage } from "../storage";
import { scrubPII, maskPIIValue } from "@shared/utils";
import type { AuditEventType, AuditLogEntry, User } from "@shared/schema";

type AuditParams = {
  user: User;
  eventType: AuditEventType;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  piiSnapshot?: Record<string, unknown>;
  requestId?: string | null;
};

export async function recordAuditEvent({
  user,
  eventType,
  targetType,
  targetId,
  metadata = {},
  piiSnapshot,
  requestId,
}: AuditParams): Promise<void> {
  const maskedMetadata = scrubPII(metadata);
  const correlationMetadata =
    requestId && typeof requestId === "string" && requestId.length > 0
      ? { ...maskedMetadata, requestId }
      : maskedMetadata;
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
    metadata: correlationMetadata,
    piiSnapshot: maskedPiiSnapshot,
  };

  await storage.recordAudit(entry);
}

export async function listAuditLogs(user: User, limit = 100): Promise<AuditLogEntry[]> {
  return storage.getAuditLogs(user.organizationId, limit);
}
