import { logger, StructuredLogger, type LoggerContext, type RequestLogger } from "./logger";

const ERROR_THRESHOLD = 3;
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;
const SLOW_THRESHOLD_MS = 60_000;

type ErrorState = {
  consecutiveErrors: number;
  lastAlertAt?: number;
};

const UNKNOWN_LABEL = "unknown";

const errorTracker = new Map<string, ErrorState>();

function getTrackerKey(clientId: string, bankAccountId?: string) {
  const accountId = bankAccountId?.trim() || UNKNOWN_LABEL;
  return `${clientId}:${accountId}`;
}

type LoggerOverride =
  | RequestLogger
  | (LoggerContext & {
      requestId: string;
    });

export function recordOfxImportOutcome(options: {
  clientId: string;
  importId: string;
  bankAccountId?: string;
  bankName?: string;
  success: boolean;
  durationMs: number;
  warnings: number;
  error?: unknown;
  logger?: LoggerOverride;
}) {
  const {
    clientId,
    importId,
    bankAccountId,
    bankName,
    success,
    durationMs,
    warnings,
    error,
    logger: providedLogger,
  } = options;
  const normalizedAccountId = bankAccountId?.trim() || UNKNOWN_LABEL;
  const normalizedBankName = bankName?.trim() || UNKNOWN_LABEL;
  const trackerKey = getTrackerKey(clientId, bankAccountId);
  const state = errorTracker.get(trackerKey) ?? { consecutiveErrors: 0 };

  const emitter = (() => {
    if (!providedLogger) {
      return logger;
    }
    if (providedLogger instanceof StructuredLogger) {
      return providedLogger;
    }
    if (providedLogger.requestId) {
      return logger.child(providedLogger);
    }
    return logger;
  })();

  if (success) {
    if (state.consecutiveErrors > 0) {
      emitter.info("Erro sustentado de importação OFX resolvido", {
        event: "alert.ofx.recovered",
        clientId,
        importId,
        bankAccountId: normalizedAccountId,
        bankName: normalizedBankName,
        context: { previousConsecutiveErrors: state.consecutiveErrors },
      });
    }
    state.consecutiveErrors = 0;
    errorTracker.set(trackerKey, state);
  } else {
    state.consecutiveErrors += 1;
    errorTracker.set(trackerKey, state);

    emitter.warn("Falha na importação OFX", {
      event: "alert.ofx.failure",
      clientId,
      importId,
      bankAccountId: normalizedAccountId,
      bankName: normalizedBankName,
      context: {
        consecutiveErrors: state.consecutiveErrors,
        durationMs,
        warnings,
      },
    }, error);

    if (
      state.consecutiveErrors >= ERROR_THRESHOLD &&
      (!state.lastAlertAt || Date.now() - state.lastAlertAt > ALERT_COOLDOWN_MS)
    ) {
      emitter.error("Alerta: erros sustentados em importação OFX", {
        event: "alert.ofx.sustained",
        clientId,
        importId,
        bankAccountId: normalizedAccountId,
        bankName: normalizedBankName,
        context: {
          consecutiveErrors: state.consecutiveErrors,
          durationMs,
          warnings,
        },
      }, error);
      state.lastAlertAt = Date.now();
      errorTracker.set(trackerKey, state);
    }
  }

  if (durationMs > SLOW_THRESHOLD_MS) {
    emitter.warn("Importação OFX lenta", {
      event: "alert.ofx.slow",
      clientId,
      importId,
      bankAccountId: normalizedAccountId,
      bankName: normalizedBankName,
      context: {
        durationMs,
        thresholdMs: SLOW_THRESHOLD_MS,
        warnings,
      },
    });
  }
}

export function resetOfxAlertState() {
  errorTracker.clear();
}
