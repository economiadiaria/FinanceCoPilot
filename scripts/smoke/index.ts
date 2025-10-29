import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";

const requiredEnvVars = [
  "STAGING_BASE_URL",
  "SMOKE_EMAIL",
  "SMOKE_PASSWORD",
  "SMOKE_CLIENT_ID",
  "SMOKE_BANK_ACCOUNT_ID",
] as const;

type EnvVar = (typeof requiredEnvVars)[number];

type EnvConfig = Record<EnvVar, string>;

function loadEnv(): EnvConfig {
  const config = {} as EnvConfig;
  for (const key of requiredEnvVars) {
    const value = process.env[key];
    if (!value || value.trim() === "") {
      throw new Error(`Environment variable ${key} is required`);
    }
    config[key] = value.trim();
  }
  return config;
}

const cookieJar = new Map<string, string>();

function storeCookies(rawCookies: string[]) {
  for (const raw of rawCookies) {
    const [pair] = raw.split(";");
    if (!pair) continue;
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex === -1) continue;
    const name = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    if (name) {
      cookieJar.set(name, value);
    }
  }
}

function buildCookieHeader(): string | undefined {
  if (cookieJar.size === 0) {
    return undefined;
  }
  return Array.from(cookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

type RequestOptions = {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
};

const requestDurations: number[] = [];

async function request(baseUrl: string, endpoint: string, options: RequestOptions = {}) {
  const method = options.method ?? "GET";
  const url = new URL(endpoint, baseUrl).toString();
  const headers = new Headers(options.headers ?? {});
  const cookieHeader = headers.has("cookie") ? headers.get("cookie") : buildCookieHeader();
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }

  const startTime = performance.now();
  const response = await fetch(url, {
    method,
    headers,
    body: options.body ?? null,
    redirect: "manual",
  });
  const endTime = performance.now();
  const durationMs = endTime - startTime;
  requestDurations.push(durationMs);

  const requestId = response.headers.get("x-request-id");
  console.log(
    `${method} ${endpoint} -> ${response.status} (X-Request-Id: ${requestId ?? "n/a"}, ${durationMs.toFixed(
      2,
    )} ms)`,
  );

  const getSetCookie = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === "function") {
    storeCookies(getSetCookie.call(response.headers));
  } else {
    const singleSetCookie = response.headers.get("set-cookie");
    if (singleSetCookie) {
      storeCookies([singleSetCookie]);
    }
  }

  if (!response.ok) {
    let errorDetail: unknown;
    try {
      const text = await response.text();
      errorDetail = text;
    } catch (error) {
      errorDetail = error instanceof Error ? error.message : String(error);
    }
    throw new Error(`${method} ${endpoint} failed with status ${response.status}: ${errorDetail}`);
  }

  return response;
}

function printRequestLatencySummary() {
  if (requestDurations.length === 0) {
    return;
  }

  const sortedDurations = [...requestDurations].sort((a, b) => a - b);
  const total = sortedDurations.reduce((sum, duration) => sum + duration, 0);
  const average = total / sortedDurations.length;
  const p95Index = Math.max(0, Math.ceil(sortedDurations.length * 0.95) - 1);
  const p95 = sortedDurations[p95Index];

  console.log(
    `Request latency summary (${sortedDurations.length} requests): avg=${average.toFixed(2)} ms, p95=${p95.toFixed(2)} ms`,
  );
}

async function main() {
  const env = loadEnv();
  const baseUrl = env.STAGING_BASE_URL.endsWith("/") ? env.STAGING_BASE_URL : `${env.STAGING_BASE_URL}/`;

  await request(baseUrl, "/healthz");
  await request(baseUrl, "/readyz");

  await request(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: env.SMOKE_EMAIL, password: env.SMOKE_PASSWORD }),
  });

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const fixturePath = path.join(currentDir, "fixtures", "sample.ofx");
  const rawOfx = await readFile(fixturePath, "utf8");
  const resolvedOfx = rawOfx.replace(/\{\{BANK_ACCOUNT_ID\}\}/g, env.SMOKE_BANK_ACCOUNT_ID);

  const formData = new FormData();
  formData.append("ofx", new Blob([resolvedOfx], { type: "application/octet-stream" }), "sample.ofx");
  formData.append("clientId", env.SMOKE_CLIENT_ID);

  await request(baseUrl, `/api/pj/import/ofx?clientId=${encodeURIComponent(env.SMOKE_CLIENT_ID)}`, {
    method: "POST",
    body: formData,
  });

  const transactionsResponse = await request(
    baseUrl,
    `/api/pj/transactions?clientId=${encodeURIComponent(env.SMOKE_CLIENT_ID)}&bankAccountId=${encodeURIComponent(env.SMOKE_BANK_ACCOUNT_ID)}&limit=1`,
  );

  const payload = (await transactionsResponse.json()) as { items?: unknown } | undefined;
  if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
    throw new Error("Smoke test failed: expected at least one bank transaction");
  }

  console.log("Smoke test completed successfully.");
}

main()
  .catch(error => {
    console.error("Smoke test failed.");
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    printRequestLatencySummary();
  });
