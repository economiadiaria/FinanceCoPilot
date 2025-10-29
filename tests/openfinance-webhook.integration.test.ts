import { describe, before, after, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import crypto from "node:crypto";

import { registerRoutes } from "../server/routes";
import { MemStorage, setStorageProvider } from "../server/storage";

const TEST_WEBHOOK_SECRET = "test-secret";

function signPayload(payload: unknown): string {
  return crypto
    .createHmac("sha256", TEST_WEBHOOK_SECRET)
    .update(JSON.stringify(payload))
    .digest("hex");
}

describe("Open Finance webhook authentication", () => {
  let appServer: import("http").Server;

  before(async () => {
    process.env.PLUGGY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

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
        secret: "openfinance-webhook-test",
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

  it("rejects webhook payloads with an invalid signature", async () => {
    const payload = {
      event: "item/created",
      itemId: "item-123",
      data: {},
    };

    const response = await request(appServer)
      .post("/api/openfinance/webhook")
      .set("X-Pluggy-Signature", "invalid-secret")
      .set("X-Pluggy-Timestamp", new Date().toISOString())
      .send(payload);

    assert.equal(response.status, 403);
    assert.equal(response.body.error, "Assinatura inválida");
  });

  it("rejects webhook payloads with a stale timestamp", async () => {
    const payload = {
      event: "item/created",
      itemId: "item-123",
      data: {},
    };

    const timestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const signature = signPayload(payload);

    const response = await request(appServer)
      .post("/api/openfinance/webhook")
      .set("X-Pluggy-Signature", signature)
      .set("X-Pluggy-Timestamp", timestamp)
      .send(payload);

    assert.equal(response.status, 401);
    assert.equal(response.body.error, "Timestamp expirado");
  });

  it("accepts webhook payloads with a valid signature and timestamp", async () => {
    const payload = {
      event: "item/created",
      itemId: "item-123",
      data: {},
    };

    const timestamp = new Date().toISOString();
    const signature = signPayload(payload);

    const response = await request(appServer)
      .post("/api/openfinance/webhook")
      .set("X-Pluggy-Signature", signature)
      .set("X-Pluggy-Timestamp", timestamp)
      .send(payload);

    assert.equal(response.status, 202);
    assert.equal(response.body.received, true);
  });

  it("rejects duplicate webhook payloads", async () => {
    const payload = {
      event: "item/created",
      itemId: "item-duplicate",
      data: {},
    };

    const timestamp = new Date().toISOString();
    const signature = signPayload(payload);

    const initialResponse = await request(appServer)
      .post("/api/openfinance/webhook")
      .set("X-Pluggy-Signature", signature)
      .set("X-Pluggy-Timestamp", timestamp)
      .send(payload);

    assert.equal(initialResponse.status, 202);

    const replayResponse = await request(appServer)
      .post("/api/openfinance/webhook")
      .set("X-Pluggy-Signature", signature)
      .set("X-Pluggy-Timestamp", timestamp)
      .send(payload);

    assert.equal(replayResponse.status, 409);
    assert.equal(replayResponse.body.error, "Webhook duplicado");
  });
});
