import type { BankTransaction } from "@shared/schema";
import { ledgerGroups } from "@shared/schema";

export type LedgerGroup = (typeof ledgerGroups)[number];

export const ledgerGroupLabels: Record<LedgerGroup, string> = {
  RECEITA: "Receitas",
  DEDUCOES_RECEITA: "(-) Deduções da Receita",
  GEA: "(-) Despesas Gerais e Administrativas",
  COMERCIAL_MKT: "(-) Despesas Comerciais e Marketing",
  FINANCEIRAS: "(-/+) Despesas e Receitas Financeiras",
  OUTRAS: "(-/+) Outras Despesas e Receitas Não Operacionais",
};

export const ledgerGroupSortOrder: Record<LedgerGroup, number> = {
  RECEITA: 10,
  DEDUCOES_RECEITA: 20,
  GEA: 30,
  COMERCIAL_MKT: 40,
  FINANCEIRAS: 50,
  OUTRAS: 60,
};

function normalizeString(value?: string | null): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .toUpperCase();
}

function inferGroupFromLegacy(value: string | undefined, amount: number): LedgerGroup | undefined {
  if (!value) return undefined;
  const normalized = normalizeString(value);

  if (normalized.includes("DEDU")) {
    return "DEDUCOES_RECEITA";
  }
  if (normalized.includes("GER") || normalized.includes("ADM")) {
    return "GEA";
  }
  if (normalized.includes("COM") || normalized.includes("MARK")) {
    return "COMERCIAL_MKT";
  }
  if (normalized.includes("FINAN")) {
    return "FINANCEIRAS";
  }
  if (normalized.includes("RECEITA") || normalized.includes("FATUR")) {
    return amount >= 0 ? "RECEITA" : "DEDUCOES_RECEITA";
  }
  if (normalized.includes("OUTR")) {
    return "OUTRAS";
  }

  return undefined;
}

export function getLedgerGroup(tx: BankTransaction): LedgerGroup {
  if (tx.categorizedAs?.group) {
    return tx.categorizedAs.group;
  }

  const legacy =
    inferGroupFromLegacy(tx.dfcCategory, tx.amount) || inferGroupFromLegacy(tx.dfcItem, tx.amount);
  if (legacy) {
    return legacy;
  }

  return tx.amount >= 0 ? "RECEITA" : "OUTRAS";
}

export const ledgerGroupDisplay = ledgerGroupLabels;
