import {
  addDays,
  addMonths,
} from "@shared/utils";
import type {
  PaymentMethod,
  SettlementParcel,
  BankTransaction,
  CategorizationRule,
} from "@shared/schema";

type LedgerGroup = CategorizationRule["action"]["category"];

export interface OfxCandidateTransaction {
  date: string;
  amount: number;
  desc: string;
  fitid?: string;
}

export function calculateSettlementPlan(
  saleDate: string,
  method: PaymentMethod | undefined,
  installments: number,
  netAmount: number
): SettlementParcel[] {
  const plan: SettlementParcel[] = [];
  const liquidacao = method?.liquidacao || "D+1";

  if (liquidacao.startsWith("D+") && !liquidacao.includes("por_parcela")) {
    const days = parseInt(liquidacao.substring(2));
    plan.push({
      n: 1,
      due: addDays(saleDate, days),
      expected: netAmount,
    });
    return plan;
  }

  if (liquidacao.includes("por_parcela")) {
    const amountPerInstallment = installments > 0 ? netAmount / installments : netAmount;

    for (let i = 0; i < (installments || 1); i++) {
      plan.push({
        n: i + 1,
        due: addMonths(saleDate, i + 1),
        expected: amountPerInstallment,
      });
    }
    return plan;
  }

  plan.push({
    n: 1,
    due: addDays(saleDate, 1),
    expected: netAmount,
  });

  return plan;
}

export function isDuplicateTransaction(
  existing: BankTransaction[],
  pending: BankTransaction[],
  candidate: OfxCandidateTransaction
): boolean {
  const matches = (tx: BankTransaction) => {
    if (candidate.fitid && tx.fitid && tx.fitid === candidate.fitid) {
      return true;
    }

    return (
      tx.date === candidate.date &&
      tx.amount === candidate.amount &&
      tx.desc === candidate.desc
    );
  };

  return existing.some(matches) || pending.some(matches);
}

export function matchesPattern(desc: string, pattern: string, matchType: string): boolean {
  const descLower = desc.toLowerCase();
  const patternLower = pattern.toLowerCase();

  switch (matchType) {
    case "exact":
      return descLower === patternLower;
    case "contains":
      return descLower.includes(patternLower);
    case "startsWith":
      return descLower.startsWith(patternLower);
    default:
      return false;
  }
}

export function extractPattern(desc: string, matchType: string): string {
  switch (matchType) {
    case "exact":
      return desc;
    case "contains":
      return desc
        .split(/\s+/)
        .filter(word => word.length > 3)[0] || desc;
    case "startsWith":
      return desc.substring(0, 10);
    default:
      return desc;
  }
}

export function applyCategorizationRules(
  transactions: BankTransaction[],
  rules: CategorizationRule[]
): number {
  let categorizedCount = 0;

  for (const tx of transactions) {
    for (const rule of rules) {
      if (rule.enabled === false) {
        continue;
      }

      if (!matchesPattern(tx.desc, rule.pattern, rule.matchType)) {
        continue;
      }

      if (rule.action.type === "categorize_as_expense" && rule.action.category) {
        tx.categorizedAs = {
          group: rule.action.category as LedgerGroup,
          subcategory: rule.action.subcategory,
          auto: true,
        };
      }

      tx.categorizedBy = "rule";
      tx.categorizedRuleId = rule.ruleId;
      categorizedCount++;
      break;
    }
  }

  return categorizedCount;
}
