import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { pjMenuItems } from "../client/src/components/app-sidebar";
import { pjRouteEntries } from "../client/src/App";

const EXPECTED_PJ_URLS = [
  "/pj/dashboard",
  "/pj/resumo",
  "/pj/transacoes",
  "/pj/relatorios",
];

describe("PJ navigation smoke", () => {
  it("exposes the expected PJ destinations in the sidebar", () => {
    const menuUrls = pjMenuItems.map((item) => item.url).sort();
    assert.deepStrictEqual(menuUrls, [...EXPECTED_PJ_URLS].sort());
  });

  it("declares routes for each PJ destination", () => {
    const routePaths = pjRouteEntries.map((entry) => entry.path);
    for (const url of EXPECTED_PJ_URLS) {
      assert(routePaths.includes(url), `App is missing PJ route for ${url}`);
    }
  });

  it("provides deterministic sidebar test ids for PJ entries", () => {
    const duplicateTestIds = pjMenuItems
      .map((item) => item.testId ?? "")
      .filter(Boolean)
      .filter((testId, index, arr) => arr.indexOf(testId) !== index);
    assert.equal(duplicateTestIds.length, 0, "PJ menu should not reuse test ids");
  });
});
