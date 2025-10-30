import type { PJDateRange } from "@/contexts/PJFiltersContext";

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

export function formatDateForApi(date: Date | undefined): string | undefined {
  if (!date) {
    return undefined;
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toApiDateRange(range: PJDateRange): { from?: string; to?: string } {
  return {
    from: formatDateForApi(range.from),
    to: formatDateForApi(range.to),
  };
}

export function formatRangeLabel(range: PJDateRange): string {
  const { from, to } = range;
  if (!from && !to) {
    return "Período não definido";
  }

  const formatter = new Intl.DateTimeFormat("pt-BR");

  if (from && to) {
    return `${formatter.format(from)} – ${formatter.format(to)}`;
  }

  if (from) {
    return `A partir de ${formatter.format(from)}`;
  }

  if (to) {
    return `Até ${formatter.format(to)}`;
  }

  return "Período não definido";
}
