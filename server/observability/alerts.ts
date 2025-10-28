import { logger } from "./logger";

const ERROR_THRESHOLD = 3;
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;
const SLOW_THRESHOLD_MS = 60_000;

type ErrorState = {
  consecutiveErrors: number;
  lastAlertAt?: number;
};

const errorTracker = new Map<string, ErrorState>();

export function recordOfxImportOutcome(options: {
  clientId: string;
  importId: string;
  success: boolean;
  durationMs: number;
  warnings: number;
  error?: unknown;
}) {
  const { clientId, importId, success, durationMs, warnings, error } = options;
  const state = errorTracker.get(clientId) ?? { consecutiveErrors: 0 };

  if (success) {
    if (state.consecutiveErrors > 0) {
      logger.info("Erro sustentado de importação OFX resolvido", {
        event: "alert.ofx.recovered",
        clientId,
        importId,
        context: { previousConsecutiveErrors: state.consecutiveErrors },
      });
    }
    state.consecutiveErrors = 0;
    errorTracker.set(clientId, state);
  } else {
    state.consecutiveErrors += 1;
    errorTracker.set(clientId, state);

    logger.warn("Falha na importação OFX", {
      event: "alert.ofx.failure",
      clientId,
      importId,
      context: {
        consecutiveErrors: state.consecutiveErrors,
      },
    }, error);

    if (
      state.consecutiveErrors >= ERROR_THRESHOLD &&
      (!state.lastAlertAt || Date.now() - state.lastAlertAt > ALERT_COOLDOWN_MS)
    ) {
      logger.error("Alerta: erros sustentados em importação OFX", {
        event: "alert.ofx.sustained",
        clientId,
        importId,
        context: {
          consecutiveErrors: state.consecutiveErrors,
        },
      }, error);
      state.lastAlertAt = Date.now();
      errorTracker.set(clientId, state);
    }
  }

  if (durationMs > SLOW_THRESHOLD_MS) {
    logger.warn("Importação OFX lenta", {
      event: "alert.ofx.slow",
      clientId,
      importId,
      context: {
        durationMs,
        thresholdMs: SLOW_THRESHOLD_MS,
        warnings,
      },
    });
  }
}
