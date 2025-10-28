import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";

const SERVICE_NAME = process.env.SERVICE_NAME || "financecopilot-api";

export const metricsRegistry = new Registry();

collectDefaultMetrics({
  register: metricsRegistry,
  labels: { service: SERVICE_NAME },
});

export const ofxIngestionDuration = new Histogram({
  name: "ofx_ingestion_duration_seconds",
  help: "Tempo de processamento de importações OFX PJ",
  labelNames: ["clientId", "status"],
  registers: [metricsRegistry],
  buckets: [0.5, 1, 2, 5, 10, 20, 30, 60, 120],
});

export const ofxIngestionErrors = new Counter({
  name: "ofx_ingestion_errors_total",
  help: "Total de erros em importações OFX PJ",
  labelNames: ["clientId", "stage"],
  registers: [metricsRegistry],
});

export const ofxIngestionActive = new Gauge({
  name: "ofx_ingestion_active",
  help: "Número de importações OFX em andamento",
  labelNames: ["clientId"],
  registers: [metricsRegistry],
});

export function startOfxIngestionTimer(clientId: string) {
  ofxIngestionActive.inc({ clientId });
  return { startedAt: process.hrtime.bigint(), clientId };
}

export function recordOfxIngestionDuration(timer: { startedAt: bigint; clientId: string }, status: "success" | "error") {
  const elapsedNs = process.hrtime.bigint() - timer.startedAt;
  const elapsedSeconds = Number(elapsedNs) / 1_000_000_000;
  ofxIngestionDuration.observe({ clientId: timer.clientId, status }, elapsedSeconds);
  ofxIngestionActive.dec({ clientId: timer.clientId });
  return elapsedSeconds * 1000;
}

export function incrementOfxError(clientId: string, stage: string) {
  ofxIngestionErrors.inc({ clientId, stage });
}
