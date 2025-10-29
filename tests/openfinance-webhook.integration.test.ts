import { describe, before, after, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import crypto from "node:crypto";

import { registerRoutes } from "../server/routes";
import { MemStorage, setStorageProvider } from "../server/storage";

const TEST_WEBHOOK_SECRET = "test-secret";

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
      .send(payload);

    assert.equal(response.status, 403);
    assert.equal(response.body.error, "Assinatura inválida");
  });

  it("accepts webhook payloads with a valid signature", async () => {
    const payload = {
      event: "item/created",
      itemId: "item-123",
      data: {},
    };

    const signature = crypto
      .createHmac("sha256", TEST_WEBHOOK_SECRET)
      .update(JSON.stringify(payload))
      .digest("hex");

    const response = await request(appServer)
      .post("/api/openfinance/webhook")
      .set("X-Pluggy-Signature", signature)
      .send(payload);

    assert.equal(response.status, 200);
    assert.equal(response.body.received, true);
  });
});
