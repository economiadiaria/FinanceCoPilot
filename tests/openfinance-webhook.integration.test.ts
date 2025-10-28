import { describe, before, after, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";

import { registerRoutes } from "../server/routes";
import { MemStorage, setStorageProvider } from "../server/storage";

const TEST_WEBHOOK_SECRET = "test-secret";

describe("Open Finance webhook authentication", () => {
  let appServer: import("http").Server;

  before(async () => {
    process.env.PLUGGY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

    const app = express();
    app.use(express.json());
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
    const response = await request(appServer)
      .post("/api/openfinance/webhook")
      .set("X-Pluggy-Signature", "invalid-secret")
      .send({
        event: "item/created",
        itemId: "item-123",
        data: {},
      });

    assert.equal(response.status, 403);
    assert.equal(response.body.error, "Assinatura inválida");
  });
});
