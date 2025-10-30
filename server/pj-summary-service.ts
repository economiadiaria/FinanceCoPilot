import type { BankSummarySnapshot, BankTransaction, SaleLeg } from "@shared/schema";
import { formatBR, toISOFromBR, isBetweenDates } from "@shared/utils";
import type { IStorage } from "./storage";
import { storage as globalStorage } from "./storage";
import {
  aggregateTransactionsByCategory,
  type CategoryHierarchyNode,
  type CategoryHierarchyResult,
  type CategoryLike,
} from "./pj-category-aggregation";
import { getLedgerGroup } from "./pj-ledger-groups";

const SUPPORTED_WINDOWS = [30, 90, 365];

type TotalsKey = "totalIn" | "totalOut" | "balance";
type KpiKey =
  | "inflowCount"
  | "outflowCount"
  | "averageTicketIn"
  | "averageTicketOut"
  | "largestIn"
  | "largestOut"
  | "averageDailyNetFlow"
  | "cashConversionRatio"
  | "receivableAmount"
  | "receivableCount"
  | "overdueReceivableAmount"
  | "overdueReceivableCount"
  | "projectedBalance";
type SeriesKey = "dailyNetFlows";

interface DailyNetFlowEntry {
  date: string;
  net: number;
}

interface PartialSummary {
  from?: string | null;
  to?: string | null;
  totals: Partial<Record<TotalsKey, number>>;
  kpis: Partial<Record<KpiKey, number>>;
  series: Partial<Record<SeriesKey, DailyNetFlowEntry[]>>;
  metadata: Record<string, unknown>;
}

interface ProvidedPaths {
  totals: Set<TotalsKey>;
  kpis: Set<KpiKey>;
  series: Set<SeriesKey>;
  metadata: Set<string>;
}

interface PartialSummaryResult {
  partial: PartialSummary;
  provided: ProvidedPaths;
}

interface SnapshotSummaryResult extends PartialSummaryResult {
  needsTransactions: boolean;
  needsSaleLegs: boolean;
  windowDays?: number;
}

interface SummaryRequest {
  orgId: string;
  clientId: string;
  bankAccountId: string;
  from?: string;
  to?: string;
}

export interface SummaryResponse {
  clientId: string;
  bankAccountId: string;
  from: string | null;
  to: string | null;
  totals: Record<TotalsKey, number>;
  kpis: Record<KpiKey, number>;
  series: Record<SeriesKey, DailyNetFlowEntry[]>;
  metadata: Record<string, unknown>;
}

function createEmptyPartialSummary(): PartialSummary {
  return {
    totals: {},
    kpis: {},
    series: {},
    metadata: {},
  };
}

function createEmptyProvided(): ProvidedPaths {
  return {
    totals: new Set(),
    kpis: new Set(),
    series: new Set(),
    metadata: new Set(),
  };
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function coerceDate(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  try {
    return formatBR(value.trim());
  } catch {
    return undefined;
  }
}

function calculateCoverageDays(from?: string | null, to?: string | null): number | undefined {
  if (!from || !to) {
    return undefined;
  }
  const start = new Date(toISOFromBR(from));
  const end = new Date(toISOFromBR(to));
  const diff = end.getTime() - start.getTime();
  if (Number.isNaN(diff)) {
    return undefined;
  }
  return diff >= 0 ? Math.floor(diff / (1000 * 60 * 60 * 24)) + 1 : undefined;
}

function ensureValidRange(from?: string | null, to?: string | null) {
  if (!from || !to) {
    return;
  }
  const start = new Date(toISOFromBR(from));
  const end = new Date(toISOFromBR(to));
  if (start > end) {
    throw new RangeError("Período inválido: data inicial maior que final");
  }
}

function parseWindowDays(snapshot: BankSummarySnapshot): number | undefined {
  const metadataWindow = coerceNumber((snapshot.metadata ?? {})["coverageDays"]);
  if (typeof metadataWindow === "number" && metadataWindow > 0) {
    return metadataWindow;
  }
  const match = snapshot.window.match(/(\d{1,4})/);
  if (!match) {
    return undefined;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractRangeFromMetadata(metadata: Record<string, unknown> | undefined) {
  const range = {
    from: undefined as string | undefined,
    to: undefined as string | undefined,
  };
  if (!metadata || typeof metadata !== "object") {
    return range;
  }

  const directFrom = coerceDate(metadata["from"]);
  const directTo = coerceDate(metadata["to"]);

  if (directFrom) {
    range.from = directFrom;
  }
  if (directTo) {
    range.to = directTo;
  }

  const metadataRange = metadata["range"];
  if (typeof metadataRange === "object" && metadataRange !== null) {
    const maybeFrom = coerceDate((metadataRange as Record<string, unknown>)["from"]);
    const maybeTo = coerceDate((metadataRange as Record<string, unknown>)["to"]);
    range.from = range.from ?? maybeFrom;
    range.to = range.to ?? maybeTo;
  }

  const start = coerceDate(metadata["start"]);
  const end = coerceDate(metadata["end"]);
  range.from = range.from ?? start;
  range.to = range.to ?? end;

  return range;
}

function normalizeDailyNetFlows(entries: unknown): DailyNetFlowEntry[] | undefined {
  if (!Array.isArray(entries)) {
    return undefined;
  }
  const normalized: DailyNetFlowEntry[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const dateValue = coerceDate(record.date ?? record["data"] ?? record["day"]);
    const netValue = coerceNumber(record.net ?? record["value"] ?? record["amount"]);
    if (!dateValue || netValue === undefined) {
      continue;
    }
    normalized.push({ date: dateValue, net: netValue });
  }
  return normalized;
}

function serializeCategoryNode(node: CategoryHierarchyNode): CategoryHierarchyNode {
  return {
    id: node.id,
    label: node.label,
    path: node.path,
    level: node.level,
    sortOrder: node.sortOrder,
    parentPath: node.parentPath,
    acceptsPostings: node.acceptsPostings,
    group: node.group,
    baseCategoryId: node.baseCategoryId,
    inflows: node.inflows,
    outflows: node.outflows,
    net: node.net,
    directInflows: node.directInflows,
    directOutflows: node.directOutflows,
    children: node.children.map(serializeCategoryNode),
  };
}

function serializeCategoryHierarchy(result: CategoryHierarchyResult) {
  return {
    roots: result.roots.map(serializeCategoryNode),
    ledgerTotals: Object.fromEntries(
      Array.from(result.ledgerByGroup.entries()).map(([group, node]) => [group, {
        inflows: node.inflows,
        outflows: node.outflows,
        net: node.net,
      }]),
    ),
  };
}

function extractSeriesFromMetadata(metadata: Record<string, unknown> | undefined) {
  if (!metadata || typeof metadata !== "object") {
    return {};
  }
  const series: Record<string, unknown> | undefined =
    typeof metadata.series === "object" && metadata.series !== null
      ? (metadata.series as Record<string, unknown>)
      : undefined;

  const directDailyNetFlows = normalizeDailyNetFlows(metadata["dailyNetFlows"]);
  const nestedDailyNetFlows = normalizeDailyNetFlows(series?.["dailyNetFlows"]);

  return {
    dailyNetFlows: nestedDailyNetFlows ?? directDailyNetFlows,
  };
}

function isTotalsKey(key: string): key is TotalsKey {
  return key === "totalIn" || key === "totalOut" || key === "balance";
}

function isKpiKey(key: string): key is KpiKey {
  return (
    key === "inflowCount" ||
    key === "outflowCount" ||
    key === "averageTicketIn" ||
    key === "averageTicketOut" ||
    key === "largestIn" ||
    key === "largestOut" ||
    key === "averageDailyNetFlow" ||
    key === "cashConversionRatio" ||
    key === "receivableAmount" ||
    key === "receivableCount" ||
    key === "overdueReceivableAmount" ||
    key === "overdueReceivableCount" ||
    key === "projectedBalance"
  );
}

function isSeriesKey(key: string): key is SeriesKey {
  return key === "dailyNetFlows";
}

class PJSummaryService {
  constructor(private readonly storageProvider: () => IStorage = () => globalStorage) {}

  private get storage(): IStorage {
    return this.storageProvider();
  }

  async getSummary(request: SummaryRequest): Promise<SummaryResponse> {
    const { orgId, clientId, bankAccountId } = request;
    const normalizedFrom = request.from;
    const normalizedTo = request.to;

    if (normalizedFrom && normalizedTo) {
      ensureValidRange(normalizedFrom, normalizedTo);
    }

    const snapshots = await this.storage.getBankSummarySnapshots(orgId, clientId, bankAccountId);
    const targetCoverage = calculateCoverageDays(normalizedFrom, normalizedTo);

    const selectedSnapshot = this.selectSnapshot(snapshots, targetCoverage);

    let cachedCategories: CategoryLike[] | undefined;
    const loadCategories = async () => {
      if (cachedCategories) {
        return cachedCategories;
      }
      if (!orgId) {
        cachedCategories = [];
        return cachedCategories;
      }
      cachedCategories = await this.storage.getPjClientCategories(orgId, clientId);
      return cachedCategories;
    };

    if (selectedSnapshot) {
      const snapshotPartial = this.buildSnapshotSummary(selectedSnapshot.snapshot, {
        rangeStart: normalizedFrom,
        rangeEnd: normalizedTo,
      });

      const partials: PartialSummaryResult[] = [];
      let usedFallback = false;

      if (snapshotPartial.needsTransactions) {
        const transactions = await this.storage.getBankTransactions(clientId, bankAccountId);
        const transactionPartial = this.computeTransactionMetrics(transactions, {
          rangeStart: snapshotPartial.partial.from ?? normalizedFrom,
          rangeEnd: snapshotPartial.partial.to ?? normalizedTo,
          categories: await loadCategories(),
        });
        partials.push(transactionPartial);
        usedFallback = true;
      }

      if (snapshotPartial.needsSaleLegs) {
        const saleLegs = await this.storage.getSaleLegs(clientId);
        const receivablesPartial = this.computeReceivableMetrics(saleLegs, {
          rangeStart: snapshotPartial.partial.from ?? normalizedFrom,
          rangeEnd: snapshotPartial.partial.to ?? normalizedTo,
        });
        partials.push(receivablesPartial);
        usedFallback = true;
      }

      partials.push({
        partial: snapshotPartial.partial,
        provided: snapshotPartial.provided,
      });

      const combined = this.combinePartials(partials);
      const finalCoverage =
        this.resolveCoverageDays(combined.partial.metadata, combined.partial.from ?? normalizedFrom, combined.partial.to ?? normalizedTo, selectedSnapshot.windowDays);

      return this.finalizeSummary({
        clientId,
        bankAccountId,
        partial: combined.partial,
        provided: combined.provided,
        coverageDays: finalCoverage,
        snapshotUsed: true,
        fallbackUsed: usedFallback,
        snapshotWindowDays: selectedSnapshot.windowDays,
      });
    }

    const transactions = await this.storage.getBankTransactions(clientId, bankAccountId);
    const transactionPartial = this.computeTransactionMetrics(transactions, {
      rangeStart: normalizedFrom,
      rangeEnd: normalizedTo,
      categories: await loadCategories(),
    });

    const saleLegs = await this.storage.getSaleLegs(clientId);
    const receivablesPartial = this.computeReceivableMetrics(saleLegs, {
      rangeStart: transactionPartial.partial.from ?? normalizedFrom,
      rangeEnd: transactionPartial.partial.to ?? normalizedTo,
    });

    const combined = this.combinePartials([transactionPartial, receivablesPartial]);
    const finalCoverage =
      this.resolveCoverageDays(combined.partial.metadata, combined.partial.from ?? normalizedFrom, combined.partial.to ?? normalizedTo, undefined);

    return this.finalizeSummary({
      clientId,
      bankAccountId,
      partial: combined.partial,
      provided: combined.provided,
      coverageDays: finalCoverage,
      snapshotUsed: false,
      fallbackUsed: true,
      snapshotWindowDays: undefined,
    });
  }

  async computeFreshSummaryFromData(options: {
    clientId: string;
    bankAccountId: string;
    transactions: BankTransaction[];
    saleLegs: SaleLeg[];
    from?: string;
    to?: string;
    windowDays?: number;
    categories?: CategoryLike[];
  }): Promise<SummaryResponse> {
    const { clientId, bankAccountId, transactions, saleLegs, from, to, windowDays, categories } = options;

    if (from && to) {
      ensureValidRange(from, to);
    }

    const transactionPartial = this.computeTransactionMetrics(transactions, {
      rangeStart: from,
      rangeEnd: to,
      categories,
    });

    const receivablePartial = this.computeReceivableMetrics(saleLegs, {
      rangeStart: from,
      rangeEnd: to,
    });

    const combined = this.combinePartials([transactionPartial, receivablePartial]);

    const finalCoverage = this.resolveCoverageDays(
      combined.partial.metadata,
      combined.partial.from ?? from,
      combined.partial.to ?? to,
      windowDays
    );

    return this.finalizeSummary({
      clientId,
      bankAccountId,
      partial: combined.partial,
      provided: combined.provided,
      coverageDays: finalCoverage,
      snapshotUsed: false,
      fallbackUsed: true,
      snapshotWindowDays: windowDays,
    });
  }

  private selectSnapshot(
    snapshots: BankSummarySnapshot[],
    targetCoverage?: number
  ): { snapshot: BankSummarySnapshot; windowDays?: number } | null {
    if (snapshots.length === 0) {
      return null;
    }

    const candidates = snapshots
      .map(snapshot => ({ snapshot, windowDays: parseWindowDays(snapshot) }))
      .filter(entry => entry.windowDays && entry.windowDays > 0) as Array<{
        snapshot: BankSummarySnapshot;
        windowDays: number;
      }>;

    if (candidates.length === 0) {
      return null;
    }

    const supported = candidates.filter(entry => SUPPORTED_WINDOWS.includes(entry.windowDays));
    const pool = supported.length > 0 ? supported : candidates;

    if (targetCoverage && targetCoverage > 0) {
      let best = pool[0];
      let bestDiff = Math.abs(best.windowDays - targetCoverage);
      for (const candidate of pool.slice(1)) {
        const diff = Math.abs(candidate.windowDays - targetCoverage);
        if (diff < bestDiff || (diff === bestDiff && candidate.windowDays < best.windowDays)) {
          best = candidate;
          bestDiff = diff;
        }
      }
      return best;
    }

    // When no coverage requested, prefer smallest supported window, defaulting to first candidate
    let best = pool[0];
    for (const candidate of pool.slice(1)) {
      if (candidate.windowDays < best.windowDays) {
        best = candidate;
      }
    }
    return best;
  }

  private buildSnapshotSummary(
    snapshot: BankSummarySnapshot,
    context: { rangeStart?: string; rangeEnd?: string }
  ): SnapshotSummaryResult {
    const partial = createEmptyPartialSummary();
    const provided = createEmptyProvided();

    const metadata = snapshot.metadata && typeof snapshot.metadata === "object"
      ? (snapshot.metadata as Record<string, unknown>)
      : undefined;

    for (const [key, value] of Object.entries(snapshot.totals ?? {})) {
      if (!isTotalsKey(key)) {
        continue;
      }
      const numeric = coerceNumber(value);
      if (numeric === undefined) {
        continue;
      }
      partial.totals[key] = numeric;
      provided.totals.add(key);
    }

    for (const [key, value] of Object.entries(snapshot.kpis ?? {})) {
      if (!isKpiKey(key)) {
        continue;
      }
      const numeric = coerceNumber(value);
      if (numeric === undefined) {
        continue;
      }
      partial.kpis[key] = numeric;
      provided.kpis.add(key);
    }

    const series = extractSeriesFromMetadata(metadata);
    if (series.dailyNetFlows) {
      partial.series.dailyNetFlows = series.dailyNetFlows;
      provided.series.add("dailyNetFlows");
    }

    const metadataRange = extractRangeFromMetadata(metadata);
    partial.from = context.rangeStart ?? metadataRange.from ?? partial.from;
    partial.to = context.rangeEnd ?? metadataRange.to ?? partial.to;

    if (metadata) {
      const transactionCount = coerceNumber(metadata["transactionCount"]);
      if (transactionCount !== undefined) {
        partial.metadata.transactionCount = transactionCount;
        provided.metadata.add("transactionCount");
      }

      const coverage = coerceNumber(metadata["coverageDays"]);
      if (coverage !== undefined) {
        partial.metadata.coverageDays = coverage;
        provided.metadata.add("coverageDays");
      }
    }

    partial.metadata.generatedAt = snapshot.refreshedAt;
    provided.metadata.add("generatedAt");
    partial.metadata.snapshotWindow = snapshot.window;
    provided.metadata.add("snapshotWindow");

    const needsTransactions =
      !provided.totals.has("totalIn") ||
      !provided.totals.has("totalOut") ||
      !provided.kpis.has("inflowCount") ||
      !provided.kpis.has("outflowCount") ||
      !provided.kpis.has("largestIn") ||
      !provided.kpis.has("largestOut") ||
      !provided.series.has("dailyNetFlows") ||
      !provided.metadata.has("transactionCount");

    const needsSaleLegs =
      !provided.kpis.has("receivableAmount") ||
      !provided.kpis.has("receivableCount") ||
      !provided.kpis.has("overdueReceivableAmount") ||
      !provided.kpis.has("overdueReceivableCount");

    return {
      partial,
      provided,
      needsTransactions,
      needsSaleLegs,
      windowDays: parseWindowDays(snapshot),
    };
  }

  private computeTransactionMetrics(
    transactions: BankTransaction[],
    context: { rangeStart?: string; rangeEnd?: string; categories?: CategoryLike[] }
  ): PartialSummaryResult {
    const partial = createEmptyPartialSummary();
    const provided = createEmptyProvided();

    const isoDates = transactions
      .filter(tx => tx.date)
      .map(tx => toISOFromBR(tx.date))
      .sort();

    let rangeStart = context.rangeStart;
    let rangeEnd = context.rangeEnd;

    if (!rangeStart && isoDates.length > 0) {
      rangeStart = formatBR(isoDates[0]);
    }

    if (!rangeEnd && isoDates.length > 0) {
      rangeEnd = formatBR(isoDates[isoDates.length - 1]);
    }

    if (rangeStart && rangeEnd) {
      ensureValidRange(rangeStart, rangeEnd);
    }

    partial.from = rangeStart ?? partial.from;
    partial.to = rangeEnd ?? partial.to;

    const filteredTransactions =
      rangeStart && rangeEnd
        ? transactions.filter(tx => isBetweenDates(tx.date, rangeStart!, rangeEnd!))
        : transactions;

    const categoryAggregation = aggregateTransactionsByCategory(filteredTransactions, {
      categories: context.categories ?? [],
      ledgerGroupResolver: getLedgerGroup,
    });
    partial.metadata.categoryHierarchy = serializeCategoryHierarchy(categoryAggregation);
    provided.metadata.add("categoryHierarchy");

    const inflowTransactions = filteredTransactions.filter(tx => tx.amount > 0);
    const outflowTransactions = filteredTransactions.filter(tx => tx.amount < 0);

    const totalIn = inflowTransactions.reduce((sum, tx) => sum + tx.amount, 0);
    const totalOut = outflowTransactions.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
    const balance = totalIn - totalOut;

    partial.totals.totalIn = totalIn;
    partial.totals.totalOut = totalOut;
    partial.totals.balance = balance;
    provided.totals.add("totalIn");
    provided.totals.add("totalOut");
    provided.totals.add("balance");

    const inflowCount = inflowTransactions.length;
    const outflowCount = outflowTransactions.length;

    partial.kpis.inflowCount = inflowCount;
    partial.kpis.outflowCount = outflowCount;
    partial.kpis.largestIn = inflowTransactions.length
      ? Math.max(...inflowTransactions.map(tx => tx.amount))
      : 0;
    partial.kpis.largestOut = outflowTransactions.length
      ? Math.max(...outflowTransactions.map(tx => Math.abs(tx.amount)))
      : 0;
    partial.kpis.averageTicketIn = inflowCount > 0 ? totalIn / inflowCount : 0;
    partial.kpis.averageTicketOut = outflowCount > 0 ? totalOut / outflowCount : 0;

    provided.kpis.add("inflowCount");
    provided.kpis.add("outflowCount");
    provided.kpis.add("largestIn");
    provided.kpis.add("largestOut");
    provided.kpis.add("averageTicketIn");
    provided.kpis.add("averageTicketOut");

    const coverageDays = calculateCoverageDays(rangeStart ?? null, rangeEnd ?? null) ?? 0;
    partial.kpis.averageDailyNetFlow = coverageDays > 0 ? balance / coverageDays : 0;
    provided.kpis.add("averageDailyNetFlow");

    partial.kpis.cashConversionRatio = totalIn > 0 ? balance / totalIn : 0;
    provided.kpis.add("cashConversionRatio");

    const aggregation = new Map<string, number>();
    for (const tx of filteredTransactions) {
      const key = formatBR(tx.date);
      const existing = aggregation.get(key) ?? 0;
      aggregation.set(key, existing + tx.amount);
    }

    const dailyNetFlows = Array.from(aggregation.entries())
      .map(([date, value]) => ({
        date,
        net: value,
      }))
      .sort((a, b) => {
        const aTime = new Date(toISOFromBR(a.date)).getTime();
        const bTime = new Date(toISOFromBR(b.date)).getTime();
        return aTime - bTime;
      });

    partial.series.dailyNetFlows = dailyNetFlows;
    provided.series.add("dailyNetFlows");

    partial.metadata.transactionCount = filteredTransactions.length;
    partial.metadata.coverageDays = coverageDays;
    partial.metadata.generatedAt = new Date().toISOString();
    provided.metadata.add("transactionCount");
    provided.metadata.add("coverageDays");
    provided.metadata.add("generatedAt");

    return { partial, provided };
  }

  private computeReceivableMetrics(
    saleLegs: SaleLeg[],
    context: { rangeStart?: string; rangeEnd?: string }
  ): PartialSummaryResult {
    const partial = createEmptyPartialSummary();
    const provided = createEmptyProvided();

    const rangeStart = context.rangeStart;
    const rangeEnd = context.rangeEnd;

    const relevantParcels = saleLegs.flatMap(leg =>
      leg.settlementPlan.filter(parcel => {
        if (parcel.receivedTxId) {
          return false;
        }
        if (!rangeStart || !rangeEnd) {
          return true;
        }
        return isBetweenDates(parcel.due, rangeStart, rangeEnd);
      })
    );

    const receivableAmount = relevantParcels.reduce((sum, parcel) => sum + parcel.expected, 0);
    partial.kpis.receivableAmount = receivableAmount;
    provided.kpis.add("receivableAmount");

    const receivableCount = relevantParcels.length;
    partial.kpis.receivableCount = receivableCount;
    provided.kpis.add("receivableCount");

    const now = new Date();
    const overdueParcels = relevantParcels.filter(parcel => {
      try {
        const dueISO = toISOFromBR(parcel.due);
        return new Date(dueISO) < now;
      } catch {
        return false;
      }
    });

    const overdueReceivableAmount = overdueParcels.reduce(
      (sum, parcel) => sum + parcel.expected,
      0
    );

    partial.kpis.overdueReceivableAmount = overdueReceivableAmount;
    partial.kpis.overdueReceivableCount = overdueParcels.length;
    provided.kpis.add("overdueReceivableAmount");
    provided.kpis.add("overdueReceivableCount");

    return { partial, provided };
  }

  private combinePartials(entries: PartialSummaryResult[]): PartialSummaryResult {
    if (entries.length === 0) {
      return { partial: createEmptyPartialSummary(), provided: createEmptyProvided() };
    }

    const combined: PartialSummary = createEmptyPartialSummary();
    const provided: ProvidedPaths = createEmptyProvided();

    for (const entry of entries) {
      const { partial, provided: providedEntry } = entry;

      if (partial.from !== undefined) {
        combined.from = partial.from;
      }
      if (partial.to !== undefined) {
        combined.to = partial.to;
      }

      for (const [key, value] of Object.entries(partial.totals)) {
        const typedKey = key as TotalsKey;
        if (!providedEntry.totals.has(typedKey) || value === undefined) {
          continue;
        }
        combined.totals[typedKey] = value;
        provided.totals.add(typedKey);
      }

      for (const [key, value] of Object.entries(partial.kpis)) {
        const typedKey = key as KpiKey;
        if (!providedEntry.kpis.has(typedKey) || value === undefined) {
          continue;
        }
        combined.kpis[typedKey] = value;
        provided.kpis.add(typedKey);
      }

      for (const [key, value] of Object.entries(partial.series)) {
        const typedKey = key as SeriesKey;
        if (!providedEntry.series.has(typedKey) || value === undefined) {
          continue;
        }
        combined.series[typedKey] = value;
        provided.series.add(typedKey);
      }

      for (const [key, value] of Object.entries(partial.metadata)) {
        if (!providedEntry.metadata.has(key) || value === undefined) {
          continue;
        }
        combined.metadata[key] = value;
        provided.metadata.add(key);
      }
    }

    return { partial: combined, provided };
  }

  private resolveCoverageDays(
    metadata: Record<string, unknown>,
    rangeStart?: string | null,
    rangeEnd?: string | null,
    fallbackWindowDays?: number
  ): number {
    const coverageFromMetadata = coerceNumber(metadata["coverageDays"]);
    if (coverageFromMetadata !== undefined) {
      return coverageFromMetadata;
    }
    const computed = calculateCoverageDays(rangeStart ?? undefined, rangeEnd ?? undefined);
    if (computed !== undefined) {
      return computed;
    }
    if (typeof fallbackWindowDays === "number") {
      return fallbackWindowDays;
    }
    return 0;
  }

  private finalizeSummary(options: {
    clientId: string;
    bankAccountId: string;
    partial: PartialSummary;
    provided: ProvidedPaths;
    coverageDays: number;
    snapshotUsed: boolean;
    fallbackUsed: boolean;
    snapshotWindowDays?: number;
  }): SummaryResponse {
    const { clientId, bankAccountId, partial, provided, coverageDays, snapshotUsed, fallbackUsed, snapshotWindowDays } = options;

    const totals: Record<TotalsKey, number> = {
      totalIn: partial.totals.totalIn ?? 0,
      totalOut: partial.totals.totalOut ?? 0,
      balance: partial.totals.balance ?? (partial.totals.totalIn ?? 0) - (partial.totals.totalOut ?? 0),
    };

    const kpis: Record<KpiKey, number> = {
      inflowCount: partial.kpis.inflowCount ?? 0,
      outflowCount: partial.kpis.outflowCount ?? 0,
      averageTicketIn: partial.kpis.averageTicketIn ?? 0,
      averageTicketOut: partial.kpis.averageTicketOut ?? 0,
      largestIn: partial.kpis.largestIn ?? 0,
      largestOut: partial.kpis.largestOut ?? 0,
      averageDailyNetFlow: partial.kpis.averageDailyNetFlow ?? 0,
      cashConversionRatio: partial.kpis.cashConversionRatio ?? 0,
      receivableAmount: partial.kpis.receivableAmount ?? 0,
      receivableCount: partial.kpis.receivableCount ?? 0,
      overdueReceivableAmount: partial.kpis.overdueReceivableAmount ?? 0,
      overdueReceivableCount: partial.kpis.overdueReceivableCount ?? 0,
      projectedBalance: partial.kpis.projectedBalance ?? 0,
    };

    if (!provided.kpis.has("averageTicketIn") && kpis.inflowCount > 0) {
      kpis.averageTicketIn = totals.totalIn / kpis.inflowCount;
    }

    if (!provided.kpis.has("averageTicketOut") && kpis.outflowCount > 0) {
      kpis.averageTicketOut = totals.totalOut / kpis.outflowCount;
    }

    if (!provided.kpis.has("averageDailyNetFlow")) {
      kpis.averageDailyNetFlow = coverageDays > 0 ? totals.balance / coverageDays : 0;
    }

    if (!provided.kpis.has("cashConversionRatio")) {
      kpis.cashConversionRatio = totals.totalIn > 0 ? totals.balance / totals.totalIn : 0;
    }

    if (!provided.kpis.has("projectedBalance")) {
      kpis.projectedBalance = totals.balance + kpis.receivableAmount;
    }

    const series: Record<SeriesKey, DailyNetFlowEntry[]> = {
      dailyNetFlows: partial.series.dailyNetFlows ?? [],
    };

    const metadata: Record<string, unknown> = { ...partial.metadata };
    metadata.transactionCount = coerceNumber(metadata.transactionCount) ?? 0;
    metadata.coverageDays = coverageDays;
    metadata.generatedAt = typeof metadata.generatedAt === "string" && metadata.generatedAt
      ? metadata.generatedAt
      : new Date().toISOString();

    metadata.dataSource = snapshotUsed ? (fallbackUsed ? "snapshot+live" : "snapshot") : "live";
    if (snapshotWindowDays) {
      metadata.snapshotWindowDays = snapshotWindowDays;
    }

    const response: SummaryResponse = {
      clientId,
      bankAccountId,
      from: partial.from ?? null,
      to: partial.to ?? null,
      totals,
      kpis,
      series,
      metadata,
    };

    return response;
  }
}

export const pjSummaryService = new PJSummaryService();

export function createPJSummaryService(storageProvider: () => IStorage) {
  return new PJSummaryService(storageProvider);
}

