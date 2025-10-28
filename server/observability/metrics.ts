import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";

const SERVICE_NAME = process.env.SERVICE_NAME || "financecopilot-api";

export const metricsRegistry = new Registry();

collectDefaultMetrics({
  register: metricsRegistry,
  labels: { service: SERVICE_NAME },
});

const UNKNOWN_LABEL_VALUE = "unknown";

function normalizeLabel(value?: string) {
  if (!value) {
    return UNKNOWN_LABEL_VALUE;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : UNKNOWN_LABEL_VALUE;
}

export const ofxIngestionDuration = new Histogram({
  name: "ofx_ingestion_duration_seconds",
  help: "Tempo de processamento de importações OFX PJ",
  labelNames: ["clientId", "bankAccountId", "status", "bankName"],
  registers: [metricsRegistry],
  buckets: [0.5, 1, 2, 5, 10, 20, 30, 60, 120],
});

export const ofxIngestionErrors = new Counter({
  name: "ofx_ingestion_errors_total",
  help: "Total de erros em importações OFX PJ",
  labelNames: ["clientId", "bankAccountId", "stage", "bankName"],
  registers: [metricsRegistry],
});

export const ofxIngestionActive = new Gauge({
  name: "ofx_ingestion_active",
  help: "Número de importações OFX em andamento",
  labelNames: ["clientId", "bankAccountId", "bankName"],
  registers: [metricsRegistry],
});

export function startOfxIngestionTimer(clientId: string, bankAccountId: string, bankName?: string) {
  const normalizedAccountId = normalizeLabel(bankAccountId);
  const normalizedBankName = normalizeLabel(bankName);
  const labels = {
    clientId,
    bankAccountId: normalizedAccountId,
    bankName: normalizedBankName,
  };

  ofxIngestionActive.inc(labels);
  return { startedAt: process.hrtime.bigint(), clientId, bankAccountId: normalizedAccountId, bankName: normalizedBankName };
}

export function recordOfxIngestionDuration(
  timer: { startedAt: bigint; clientId: string; bankAccountId: string; bankName: string },
  status: "success" | "error"
) {
  const elapsedNs = process.hrtime.bigint() - timer.startedAt;
  const elapsedSeconds = Number(elapsedNs) / 1_000_000_000;
  ofxIngestionDuration.observe(
    { clientId: timer.clientId, bankAccountId: timer.bankAccountId, bankName: timer.bankName, status },
    elapsedSeconds
  );
  ofxIngestionActive.dec({ clientId: timer.clientId, bankAccountId: timer.bankAccountId, bankName: timer.bankName });
  return elapsedSeconds * 1000;
}

export function incrementOfxError(clientId: string, bankAccountId: string, stage: string, bankName?: string) {
  ofxIngestionErrors.inc({
    clientId,
    bankAccountId: normalizeLabel(bankAccountId),
    bankName: normalizeLabel(bankName),
    stage,
  });
}
