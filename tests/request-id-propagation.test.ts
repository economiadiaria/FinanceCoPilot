import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { apiRequest, getQueryFn, type ApiResponse } from "../client/src/lib/queryClient";
import { extractRequestId, type RequestIdentifier } from "../client/src/lib/requestId";
import { computeRequestIdToasts } from "../client/src/hooks/useRequestIdToasts";

const originalFetch = globalThis.fetch;

describe("Request ID propagation", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("propagates request ids on successful apiRequest calls", async () => {
    const mockedResponse = new Response("{}", {
      status: 200,
      headers: { "X-Request-Id": "req-success-123" },
    });

    globalThis.fetch = async () => mockedResponse;

    const response = await apiRequest("GET", "https://example.test/api");
    assert.equal((response as ApiResponse).requestId, "req-success-123");
  });

  it("preserves request ids on apiRequest errors", async () => {
    const mockedResponse = new Response("Erro interno", {
      status: 500,
      headers: { "X-Request-Id": "req-error-500" },
    });

    globalThis.fetch = async () => mockedResponse;

    await assert.rejects(apiRequest("GET", "https://example.test/failure"), error => {
      assert.equal(extractRequestId(error), "req-error-500");
      return true;
    });
  });

  it("attaches request ids to getQueryFn results", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ payload: true }), {
        status: 200,
        headers: { "X-Request-Id": "req-query-abc" },
      });

    const queryFn = getQueryFn<{ payload: boolean }>({ on401: "throw" });
    const data = await queryFn({ queryKey: ["/api/pj/custom", { clientId: "client-123" }] });

    assert.equal(extractRequestId(data), "req-query-abc");
  });

  it("computes toast payloads with normalized request ids", () => {
    const displayed = new Set<RequestIdentifier>();
    const payloads = computeRequestIdToasts({
      context: "Painel",
      displayed,
      requestIds: ["req-1", null, "req-2"],
    });

    assert.deepEqual(
      payloads.map((payload) => payload.requestId),
      ["req-1", "req-2"],
    );
    payloads.forEach(({ requestId }) => displayed.add(requestId));

    payloads.forEach(({ payload }) => {
      assert.match(payload.description, /X-Request-Id: req-/);
    });

    const deduped = computeRequestIdToasts({
      context: "Painel",
      displayed,
      requestIds: ["req-1", "req-2"],
    });

    assert.equal(deduped.length, 0, "already displayed request ids should not re-trigger toasts");
  });
});
