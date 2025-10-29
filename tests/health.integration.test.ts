import { describe, before, after, beforeEach, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import { registerRoutes } from "../server/routes";
import { metricsRegistry } from "../server/observability/metrics";
import { MemStorage, setStorageProvider, storage } from "../server/storage";

describe("Health and readiness endpoints", () => {
  let appServer: import("http").Server;
  let originalSessionSecret: string | undefined;

  before(async () => {
    originalSessionSecret = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "test-readiness-secret";

    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use(
      session({
        secret: "test-readiness-secret",
        resave: false,
        saveUninitialized: false,
      })
    );

    setStorageProvider(new MemStorage());

    appServer = await registerRoutes(app);
  });

  after(async () => {
    process.env.SESSION_SECRET = originalSessionSecret;
    if (appServer?.listening) {
      await new Promise<void>((resolve, reject) => {
        appServer.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  beforeEach(() => {
    setStorageProvider(new MemStorage());
    metricsRegistry.resetMetrics();
  });

  it("exposes build metadata on /healthz", async () => {
    const response = await request(appServer).get("/healthz").expect(200);

    assert.equal(response.body.status, "ok");
    assert.equal(response.body.service, process.env.SERVICE_NAME ?? "financecopilot-api");
    assert.ok(Object.prototype.hasOwnProperty.call(response.body, "commit"));
  });

  it("confirms readiness when dependencies are healthy", async () => {
    const response = await request(appServer).get("/readyz").expect(200);

    assert.equal(response.body.status, "ok");
    assert.equal(response.body.dependencies.storage.status, "ok");
    assert.equal(response.body.dependencies.sessionSecret.status, "ok");
    assert.equal(response.body.dependencies.pluggy.status, "skipped");
  });

  it("reports failing subsystems on readiness errors", async () => {
    const failingStorage = storage;
    const originalCheckHealth = failingStorage.checkHealth.bind(failingStorage);
    const failure = new Error("storage unavailable");

    failingStorage.checkHealth = async () => {
      throw failure;
    };

    try {
      const response = await request(appServer).get("/readyz").expect(503);

      assert.equal(response.body.status, "error");
      assert.equal(response.body.dependencies.storage.status, "error");
      assert.match(response.body.dependencies.storage.message, /storage unavailable/);
    } finally {
      failingStorage.checkHealth = originalCheckHealth;
    }
  });
});
