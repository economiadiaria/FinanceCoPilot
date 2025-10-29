import { describe, before, after, beforeEach, afterEach, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import crypto from "node:crypto";

import { registerRoutes } from "../server/routes";
import { MemStorage, setStorageProvider } from "../server/storage";
import { storage } from "../server/storage";

describe("Open Finance webhook observability", () => {
  const TEST_SECRET = "openfinance-log-secret";
  let appServer: import("http").Server;

  const signPayload = (payload: unknown): string =>
    crypto.createHmac("sha256", TEST_SECRET).update(JSON.stringify(payload)).digest("hex");

  let capturedLogs: any[][];
  let originalConsoleLog: typeof console.log;

  before(async () => {
    process.env.PLUGGY_WEBHOOK_SECRET = TEST_SECRET;

    const app = express();
    app.use(
      express.json({
        verify: (req, _res, buf) => {
          (req as any).rawBody = buf;
        },
      })
    );
    app.use(express.urlencoded({ extended: false }));
    app.use(
      session({
        secret: "openfinance-webhook-observability",
        resave: false,
        saveUninitialized: false,
      })
    );

    setStorageProvider(new MemStorage());
    appServer = await registerRoutes(app);
  });

  after(async () => {
    delete process.env.PLUGGY_WEBHOOK_SECRET;
    if (appServer?.listening) {
      await new Promise<void>((resolve, reject) => {
        appServer.close(err => (err ? reject(err) : resolve()));
      });
    }
  });

  beforeEach(() => {
    setStorageProvider(new MemStorage());
    capturedLogs = [];
    originalConsoleLog = console.log;
    console.log = (...args: any[]) => {
      capturedLogs.push(args);
    };
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  it("captures bank account context for accepted webhooks", async () => {
    const payload = {
      event: "accounts/updated",
      itemId: "item-accepted",
      data: { accountId: "acc-accepted" },
    };

    const timestamp = new Date().toISOString();
    const signature = signPayload(payload);

    const response = await request(appServer)
      .post("/api/openfinance/webhook")
      .set("X-Pluggy-Signature", signature)
      .set("X-Pluggy-Timestamp", timestamp)
      .send(payload);

    assert.equal(response.status, 202);

    const structuredLogs = capturedLogs
      .map(([entry]) => {
        if (typeof entry === "string") {
          try {
            return JSON.parse(entry) as Record<string, unknown>;
          } catch {
            return null;
          }
        }
        return null;
      })
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));

    const webhookLog = structuredLogs.find(
      log => log.message === "Webhook received" && log.event === "openfinance.webhook"
    );
    assert.ok(webhookLog, "expected webhook log entry to be emitted");
    assert.equal(webhookLog?.bankAccountId, "acc-accepted");
    assert.deepEqual(webhookLog?.context, {
      eventType: "accounts/updated",
      itemId: "item-accepted",
      bankAccountIds: ["acc-accepted"],
    });

    const auditLogs = await storage.getAuditLogs("system", 5);
    assert.ok(auditLogs.length >= 1);
    const auditEntry = auditLogs[0];
    const metadata = auditEntry.metadata as Record<string, unknown>;
    assert.equal(auditEntry.eventType, "openfinance.webhook.accepted");
    assert.equal(metadata.bankAccountId, "acc-accepted");
    assert.deepEqual(metadata.bankAccountIds, ["acc-accepted"]);
    const signatureMetadata = metadata.signature as Record<string, unknown> | undefined;
    assert.equal(signatureMetadata?.provided, signature);
    assert.equal(signatureMetadata?.timestamp, timestamp);
  });

  it("records bank-account-aware metadata for rejected duplicates", async () => {
    const payload = {
      event: "transactions/created",
      itemId: "item-duplicate",
      data: { transactions: [{ accountId: "acc-duplicate" }] },
    };

    const timestamp = new Date().toISOString();
    const signature = signPayload(payload);

    await request(appServer)
      .post("/api/openfinance/webhook")
      .set("X-Pluggy-Signature", signature)
      .set("X-Pluggy-Timestamp", timestamp)
      .send(payload)
      .expect(202);

    // Reset captured calls to focus on the duplicate attempt
    capturedLogs = [];

    const duplicateResponse = await request(appServer)
      .post("/api/openfinance/webhook")
      .set("X-Pluggy-Signature", signature)
      .set("X-Pluggy-Timestamp", timestamp)
      .send(payload);

    assert.equal(duplicateResponse.status, 409);

    const structuredLogs = capturedLogs
      .map(([entry]) => {
        if (typeof entry === "string") {
          try {
            return JSON.parse(entry) as Record<string, unknown>;
          } catch {
            return null;
          }
        }
        return null;
      })
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));

    const duplicateLog = structuredLogs.find(
      log => log.message === "Duplicate Pluggy webhook received"
    );
    assert.ok(duplicateLog, "expected duplicate webhook warning to be logged");
    assert.equal(duplicateLog?.bankAccountId, "acc-duplicate");
    const duplicateContext = duplicateLog?.context as Record<string, unknown>;
    assert.deepEqual(duplicateContext?.bankAccountIds, ["acc-duplicate"]);

    const auditLogs = await storage.getAuditLogs("system", 5);
    assert.ok(auditLogs.length >= 1);
    const rejectionAudit = auditLogs[0];
    const metadata = rejectionAudit.metadata as Record<string, unknown>;
    assert.equal(rejectionAudit.eventType, "openfinance.webhook.rejected");
    assert.equal(metadata.reason, "duplicate");
    assert.equal(metadata.bankAccountId, "acc-duplicate");
    assert.deepEqual(metadata.bankAccountIds, ["acc-duplicate"]);
    const signatureMetadata = metadata.signature as Record<string, unknown> | undefined;
    assert.equal(signatureMetadata?.provided, signature);
    assert.equal(signatureMetadata?.timestamp, timestamp);
  });
});
