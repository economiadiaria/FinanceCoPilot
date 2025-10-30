import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import cron from "node-cron";

import { closeDb, initDb } from "./db/client";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic } from "./vite";
import type { User } from "@shared/schema";
import { scrubPII } from "@shared/utils";
import { requestLoggingMiddleware, getLogger, logger } from "./observability/logger";
import { refreshAllActiveAccountSnapshots } from "./pj-summary-aggregator";

const app = express();

initDb();

const shutdownSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
for (const signal of shutdownSignals) {
  process.once(signal, () => {
    logger.info("Shutdown signal received", {
      event: "server.shutdown",
      context: { signal },
    });

    closeDb()
      .catch(error => {
        logger.error("Failed to close database connection", undefined, error);
      })
      .finally(() => {
        process.exit(0);
      });
  });
}

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}

declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

// Configure express-session
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);

app.use(requestLoggingMiddleware);

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        const sanitized = scrubPII(capturedJsonResponse);
        logLine += ` :: ${JSON.stringify(sanitized)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      logger.info(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  cron.schedule("0 * * * *", async () => {
    const jobLogger = logger.child({ event: "pj.snapshot.scheduler" });
    jobLogger.info("Scheduled PJ snapshot refresh started");
    try {
      await refreshAllActiveAccountSnapshots({ logger: jobLogger });
      jobLogger.info("Scheduled PJ snapshot refresh completed");
    } catch (error) {
      jobLogger.error("Scheduled PJ snapshot refresh failed", undefined, error);
    }
  });

  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    const requestLogger = getLogger(req);
    requestLogger.error("Unhandled error", {
      event: "http.error",
      userId: req.authUser?.userId,
      clientId: req.clientContext?.clientId,
    }, err);
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    console.log("\n🚀 SaaS Economia Diária iniciado. Acesse /api/docs para ver endpoints.\n");
    const serverLogger = getLogger();
    serverLogger.info("Servidor iniciado", {
      event: "server.start",
      context: { port },
    });
  });
})();
