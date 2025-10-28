import { test } from "node:test";
import assert from "node:assert/strict";

import { recordOfxImportOutcome, resetOfxAlertState } from "../server/observability/alerts";
import { logger } from "../server/observability/logger";

type CapturedLog = {
  level: "info" | "warn" | "error";
  message: string;
  context: any;
  error?: unknown;
};

function stubLogger() {
  const originalInfo = logger.info;
  const originalWarn = logger.warn;
  const originalError = logger.error;
  const logs: CapturedLog[] = [];

  (logger as any).info = (message: string, context?: any) => {
    logs.push({ level: "info", message, context });
  };

  (logger as any).warn = (message: string, context?: any, error?: unknown) => {
    logs.push({ level: "warn", message, context, error });
  };

  (logger as any).error = (message: string, context?: any, error?: unknown) => {
    logs.push({ level: "error", message, context, error });
  };

  const restore = () => {
    (logger as any).info = originalInfo;
    (logger as any).warn = originalWarn;
    (logger as any).error = originalError;
  };

  return { logs, restore };
}

test("recordOfxImportOutcome tracks errors per bank account", () => {
  const { logs, restore } = stubLogger();
  resetOfxAlertState();

  try {
    const maskedBankA = "Banco ***1234";
    const maskedBankB = "Banco ***9876";

    recordOfxImportOutcome({
      clientId: "client-1",
      importId: "import-1",
      bankAccountId: "acc-a",
      bankName: maskedBankA,
      success: false,
      durationMs: 1500,
      warnings: 1,
      error: new Error("erro 1"),
    });

    recordOfxImportOutcome({
      clientId: "client-1",
      importId: "import-2",
      bankAccountId: "acc-a",
      bankName: maskedBankA,
      success: false,
      durationMs: 1400,
      warnings: 2,
      error: new Error("erro 2"),
    });

    recordOfxImportOutcome({
      clientId: "client-1",
      importId: "import-b",
      bankAccountId: "acc-b",
      bankName: maskedBankB,
      success: false,
      durationMs: 1600,
      warnings: 0,
      error: new Error("erro b"),
    });

    recordOfxImportOutcome({
      clientId: "client-1",
      importId: "import-3",
      bankAccountId: "acc-a",
      bankName: maskedBankA,
      success: false,
      durationMs: 1700,
      warnings: 3,
      error: new Error("erro 3"),
    });

    const failureLogs = logs.filter(log => log.context?.event === "alert.ofx.failure");
    assert.equal(
      failureLogs.filter(log => log.context?.bankAccountId === "acc-a").length,
      3,
      "should log each failure for account A"
    );
    const accBFailure = failureLogs.find(log => log.context?.bankAccountId === "acc-b");
    assert.ok(accBFailure, "should log failure for account B");
    assert.equal(accBFailure?.context?.bankName, maskedBankB);
    assert.equal(accBFailure?.context?.context?.consecutiveErrors, 1);

    const sustainedLog = logs.find(
      log => log.level === "error" && log.context?.event === "alert.ofx.sustained"
    );
    assert.ok(sustainedLog, "sustained alert should be emitted after threshold");
    assert.equal(sustainedLog?.context?.bankAccountId, "acc-a");
    assert.equal(sustainedLog?.context?.bankName, maskedBankA);
    assert.equal(sustainedLog?.context?.context?.consecutiveErrors, 3);
  } finally {
    restore();
    resetOfxAlertState();
  }
});

test("recordOfxImportOutcome logs recovery per account with masked identifiers", () => {
  const { logs, restore } = stubLogger();
  resetOfxAlertState();

  try {
    const maskedBankA = "Banco ***1234";
    const maskedBankB = "Banco ***5678";

    recordOfxImportOutcome({
      clientId: "client-2",
      importId: "import-1",
      bankAccountId: "acc-a",
      bankName: maskedBankA,
      success: false,
      durationMs: 2000,
      warnings: 0,
      error: new Error("erro a"),
    });

    recordOfxImportOutcome({
      clientId: "client-2",
      importId: "import-2",
      bankAccountId: "acc-a",
      bankName: maskedBankA,
      success: false,
      durationMs: 2200,
      warnings: 1,
      error: new Error("erro a2"),
    });

    logs.length = 0;

    recordOfxImportOutcome({
      clientId: "client-2",
      importId: "import-3",
      bankAccountId: "acc-a",
      bankName: maskedBankA,
      success: true,
      durationMs: 500,
      warnings: 0,
    });

    recordOfxImportOutcome({
      clientId: "client-2",
      importId: "import-b",
      bankAccountId: "acc-b",
      bankName: maskedBankB,
      success: true,
      durationMs: 400,
      warnings: 0,
    });

    const recoveryLogs = logs.filter(log => log.context?.event === "alert.ofx.recovered");
    assert.equal(recoveryLogs.length, 1, "only account with prior errors should log recovery");
    const recoveryLog = recoveryLogs[0];
    assert.equal(recoveryLog.context?.bankAccountId, "acc-a");
    assert.equal(recoveryLog.context?.bankName, maskedBankA);
    assert.equal(recoveryLog.context?.context?.previousConsecutiveErrors, 2);

    recordOfxImportOutcome({
      clientId: "client-2",
      importId: "import-4",
      bankAccountId: "acc-a",
      bankName: maskedBankA,
      success: false,
      durationMs: 800,
      warnings: 0,
      error: new Error("erro a3"),
    });

    const latestFailure = logs
      .filter(log => log.context?.event === "alert.ofx.failure")
      .find(log => log.context?.bankAccountId === "acc-a");
    assert.equal(latestFailure?.context?.context?.consecutiveErrors, 1);
  } finally {
    restore();
    resetOfxAlertState();
  }
});
