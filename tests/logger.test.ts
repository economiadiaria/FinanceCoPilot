import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";

import { requestLoggingMiddleware } from "../server/observability/logger";

test("requestLoggingMiddleware echoes incoming X-Request-Id header", async () => {
  const app = express();
  app.use(requestLoggingMiddleware);
  app.get("/api/ping", (_req, res) => {
    res.json({ ok: true });
  });

  const response = await request(app)
    .get("/api/ping")
    .set("X-Request-Id", "external-id-123");

  assert.equal(response.status, 200);
  assert.equal(response.headers["x-request-id"], "external-id-123");
  assert.deepEqual(response.body, { ok: true });
});

test("requestLoggingMiddleware assigns a request id when missing", async () => {
  const app = express();
  app.use(requestLoggingMiddleware);
  app.get("/api/ping", (_req, res) => {
    res.json({ ok: true });
  });

  const response = await request(app).get("/api/ping");

  assert.equal(response.status, 200);
  assert.ok(response.headers["x-request-id"], "request id header should be present");
  assert.match(response.headers["x-request-id"], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});
