import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { scrubPII } from "@shared/utils";

const SERVICE_NAME = process.env.SERVICE_NAME || "financecopilot-api";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerContext {
  requestId?: string;
  userId?: string;
  clientId?: string;
  importId?: string;
  bankAccountId?: string;
  bankName?: string;
  event?: string;
  context?: Record<string, unknown>;
}

interface LogPayload extends LoggerContext {
  errorMessage?: string | null;
  errorStack?: string | null;
}

export class StructuredLogger {
  constructor(private readonly baseContext: LoggerContext = {}) {}

  child(context: LoggerContext) {
    return new StructuredLogger({ ...this.baseContext, ...context });
  }

  private emit(level: LogLevel, message: string, context: LoggerContext = {}, error?: unknown) {
    const merged = { ...this.baseContext, ...context } satisfies LoggerContext;
    const cleanedContext = merged.context ? scrubPII(merged.context) : undefined;

    const payload: LogPayload = {
      requestId: merged.requestId,
      userId: merged.userId,
      clientId: merged.clientId,
      importId: merged.importId,
      bankAccountId: merged.bankAccountId,
      bankName: merged.bankName,
      event: merged.event,
      context: cleanedContext,
      errorMessage: null,
      errorStack: null,
    };

    if (error instanceof Error) {
      payload.errorMessage = error.message;
      payload.errorStack = error.stack ?? null;
    } else if (typeof error === "string") {
      payload.errorMessage = error;
    } else if (error) {
      payload.errorMessage = JSON.stringify(error);
    }

    const logLine = {
      timestamp: new Date().toISOString(),
      level,
      service: SERVICE_NAME,
      message,
      ...payload,
    };

    console.log(JSON.stringify(logLine));
  }

  debug(message: string, context?: LoggerContext) {
    this.emit("debug", message, context);
  }

  info(message: string, context?: LoggerContext) {
    this.emit("info", message, context);
  }

  warn(message: string, context?: LoggerContext, error?: unknown) {
    this.emit("warn", message, context, error);
  }

  error(message: string, context?: LoggerContext, error?: unknown) {
    this.emit("error", message, context, error);
  }
}

export const logger = new StructuredLogger();

export function createRequestLogger(requestId?: string) {
  return logger.child({ requestId: requestId ?? randomUUID() });
}

export function bindRequestLogger(req: Request, loggerInstance = createRequestLogger(req.requestId)) {
  const reqId = req.requestId ?? randomUUID();
  req.requestId = reqId;
  req.logger = loggerInstance.child({ requestId: reqId });
  return req.logger;
}

export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = (req.headers["x-request-id"] as string | undefined) ?? randomUUID();
  const requestLogger = createRequestLogger(requestId);

  req.requestId = requestId;
  req.logger = requestLogger;
  res.setHeader("X-Request-Id", requestId);

  const start = process.hrtime.bigint();
  let capturedJsonResponse: unknown;
  const originalJson = res.json;
  res.json = function patchedJson(body: any) {
    capturedJsonResponse = body;
    return originalJson.call(res, body);
  } as typeof res.json;

  res.on("finish", () => {
    if (!req.path.startsWith("/api")) {
      return;
    }

    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const sanitizedResponse = capturedJsonResponse ? scrubPII(capturedJsonResponse) : undefined;
    requestLogger.info("HTTP request completed", {
      event: "http.response",
      requestId,
      userId: req.authUser?.userId,
      clientId: req.clientContext?.clientId,
      context: {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs,
        response: sanitizedResponse,
      },
    });
  });

  next();
}

export function updateRequestLoggerContext(req: Request, context: LoggerContext) {
  if (req.logger) {
    req.logger = req.logger.child(context);
  } else {
    req.logger = logger.child(context);
  }
}

export function getLogger(req?: Request) {
  return req?.logger ?? logger;
}

export type RequestLogger = StructuredLogger;
