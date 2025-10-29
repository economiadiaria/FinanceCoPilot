import { formatBR, toISOFromBR } from "@shared/utils";
import type { BankSummarySnapshot, BankTransaction, SaleLeg } from "@shared/schema";
import { pjSummaryService } from "./pj-summary-service";
import { storage } from "./storage";
import { logger, type StructuredLogger } from "./observability/logger";

const SNAPSHOT_WINDOWS = [30, 90, 365];

type SnapshotTarget = {
  organizationId: string;
  clientId: string;
  bankAccountId: string;
};

type RefreshOptions = {
  now?: Date | string;
};

type RefreshManyOptions = SnapshotTarget & {
  bankAccountIds: Iterable<string | null | undefined>;
  logger?: StructuredLogger;
  now?: Date | string;
};

type RefreshAllOptions = {
  logger?: StructuredLogger;
  now?: Date | string;
};

function normalizeDateInput(value?: Date | string): Date {
  if (!value) {
    return new Date();
  }

  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  return new Date();
}

function toISODateString(date: Date): string {
  return date.toISOString().split("T")[0] ?? new Date().toISOString().split("T")[0];
}

function determineReferenceIsoDate(transactions: BankTransaction[], fallback: Date): string {
  const isoDates: string[] = [];
  for (const tx of transactions) {
    if (!tx.date) {
      continue;
    }
    try {
      isoDates.push(toISOFromBR(tx.date));
    } catch {
      continue;
    }
  }
  if (isoDates.length === 0) {
    return toISODateString(fallback);
  }
  isoDates.sort();
  return isoDates[isoDates.length - 1];
}

function computeWindowRange(referenceIsoDate: string, windowDays: number) {
  const end = new Date(`${referenceIsoDate}T00:00:00.000Z`);
  const start = new Date(end);
  if (windowDays > 0) {
    start.setUTCDate(start.getUTCDate() - (windowDays - 1));
  }
  const startIso = toISODateString(start);
  const endIso = toISODateString(end);
  return {
    from: formatBR(startIso),
    to: formatBR(endIso),
  };
}

function coerceUniqueAccountIds(ids: Iterable<string | null | undefined>): string[] {
  const unique = new Set<string>();
  for (const id of ids) {
    if (!id) {
      continue;
    }
    const trimmed = id.trim();
    if (trimmed) {
      unique.add(trimmed);
    }
  }
  return Array.from(unique.values());
}

async function loadData(clientId: string, bankAccountId: string) {
  const [transactions, saleLegs] = await Promise.all([
    storage.getBankTransactions(clientId, bankAccountId),
    storage.getSaleLegs(clientId),
  ]);
  return { transactions, saleLegs };
}

function buildSnapshotMetadata(
  summary: Awaited<ReturnType<typeof pjSummaryService.computeFreshSummaryFromData>>,
  windowDays: number,
  refreshedAt: string,
  defaultRange: { from: string; to: string }
): Record<string, unknown> {
  const base = { ...summary.metadata };

  const from = summary.from ?? defaultRange.from;
  const to = summary.to ?? defaultRange.to;

  const transactionCount = typeof base.transactionCount === "number"
    ? base.transactionCount
    : Number(base.transactionCount ?? 0);

  return {
    ...base,
    transactionCount: Number.isFinite(transactionCount) ? transactionCount : 0,
    coverageDays: base.coverageDays ?? windowDays,
    generatedAt: refreshedAt,
    snapshotWindowDays: windowDays,
    dataSource: "snapshot",
    from,
    to,
    range: { from, to },
    series: {
      dailyNetFlows: summary.series.dailyNetFlows,
    },
  };
}

export async function refreshAccountSnapshots(
  target: SnapshotTarget,
  options: RefreshOptions = {}
): Promise<BankSummarySnapshot[]> {
  const { organizationId, clientId, bankAccountId } = target;
  const referenceFallback = normalizeDateInput(options.now);

  const { transactions, saleLegs } = await loadData(clientId, bankAccountId);
  const referenceIso = determineReferenceIsoDate(transactions, referenceFallback);

  const snapshots: BankSummarySnapshot[] = [];

  for (const windowDays of SNAPSHOT_WINDOWS) {
    const range = computeWindowRange(referenceIso, windowDays);
    const summary = await pjSummaryService.computeFreshSummaryFromData({
      clientId,
      bankAccountId,
      transactions,
      saleLegs,
      from: range.from,
      to: range.to,
      windowDays,
    });

    const refreshedAt = new Date().toISOString();
    const metadata = buildSnapshotMetadata(summary, windowDays, refreshedAt, range);

    snapshots.push({
      organizationId,
      clientId,
      bankAccountId,
      window: `${windowDays}d`,
      totals: summary.totals,
      kpis: summary.kpis,
      metadata,
      refreshedAt,
    });
  }

  await storage.setBankSummarySnapshots(organizationId, clientId, bankAccountId, snapshots);
  return snapshots;
}

export async function refreshSnapshotsForAccounts(options: RefreshManyOptions): Promise<void> {
  const accountIds = coerceUniqueAccountIds(options.bankAccountIds);
  if (accountIds.length === 0) {
    return;
  }

  const baseLogger = (options.logger ?? logger).child({
    event: "pj.snapshot.refresh",
    clientId: options.clientId,
  });

  for (const accountId of accountIds) {
    const accountLogger = baseLogger.child({ bankAccountId: accountId });
    try {
      await refreshAccountSnapshots(
        {
          organizationId: options.organizationId,
          clientId: options.clientId,
          bankAccountId: accountId,
        },
        { now: options.now }
      );
      accountLogger.info("PJ snapshots refreshed", {
        context: {
          organizationId: options.organizationId,
          clientId: options.clientId,
        },
      });
    } catch (error) {
      accountLogger.error(
        "Failed to refresh PJ snapshots",
        {
          context: {
            organizationId: options.organizationId,
            clientId: options.clientId,
          },
        },
        error
      );
    }
  }
}

export async function refreshAllActiveAccountSnapshots(options: RefreshAllOptions = {}): Promise<void> {
  const globalLogger = (options.logger ?? logger).child({ event: "pj.snapshot.scheduler" });
  const clients = await storage.getClients();

  for (const client of clients) {
    const accounts = await storage.getBankAccounts(client.organizationId, client.clientId);
    const activeAccounts = accounts.filter(account => account.isActive);
    if (activeAccounts.length === 0) {
      continue;
    }
    await refreshSnapshotsForAccounts({
      organizationId: client.organizationId,
      clientId: client.clientId,
      bankAccountIds: activeAccounts.map(account => account.id),
      logger: globalLogger.child({ clientId: client.clientId }),
      now: options.now,
    });
  }
}

export const snapshotWindows = [...SNAPSHOT_WINDOWS];
