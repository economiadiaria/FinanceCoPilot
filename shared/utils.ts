// Utilit ários de data brasileira (DD/MM/YYYY)

/**
 * Converte data DD/MM/YYYY para ISO YYYY-MM-DD
 */
export function toISOFromBR(dateBR: string): string {
  if (!dateBR) return "";
  
  // Se já está em formato ISO, retorna
  if (dateBR.includes("-") && dateBR.length === 10) {
    return dateBR;
  }
  
  const [day, month, year] = dateBR.split("/");
  if (!day || !month || !year) {
    throw new Error(`Data inválida: ${dateBR}. Use DD/MM/YYYY`);
  }
  
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/**
 * Converte data ISO YYYY-MM-DD ou OFX YYYYMMDD para DD/MM/YYYY
 * Também aceita DD/MM/YYYY e retorna como está
 */
export function formatBR(dateISOOrBR: string): string {
  if (!dateISOOrBR) return "";
  
  // Se já está em formato BR, retorna
  if (dateISOOrBR.includes("/")) {
    return dateISOOrBR;
  }
  
  // Se é formato OFX YYYYMMDD (8 caracteres, sem separadores)
  if (dateISOOrBR.length === 8 && /^\d{8}$/.test(dateISOOrBR)) {
    const year = dateISOOrBR.substring(0, 4);
    const month = dateISOOrBR.substring(4, 6);
    const day = dateISOOrBR.substring(6, 8);
    return `${day}/${month}/${year}`;
  }
  
  // Converte de ISO YYYY-MM-DD para BR
  const [year, month, day] = dateISOOrBR.split("T")[0].split("-");
  if (!year || !month || !day) {
    throw new Error(`Data inválida: ${dateISOOrBR}`);
  }
  
  return `${day}/${month}/${year}`;
}

/**
 * Extrai chave do mês (AAAA-MM) de uma data DD/MM/YYYY
 */
export function getMonthKey(dateBR: string): string {
  const iso = toISOFromBR(dateBR);
  return iso.substring(0, 7); // YYYY-MM
}

/**
 * Verifica se uma data DD/MM/YYYY pertence a um período AAAA-MM
 */
export function inPeriod(dateBR: string, period: string): boolean {
  return getMonthKey(dateBR) === period;
}

/**
 * Verifica se uma data DD/MM/YYYY está entre duas datas (inclusive)
 */
export function isBetweenDates(
  dateBR: string,
  startDateBR: string,
  endDateBR: string
): boolean {
  if (!dateBR || !startDateBR || !endDateBR) {
    return false;
  }

  const date = new Date(toISOFromBR(dateBR));
  const start = new Date(toISOFromBR(startDateBR));
  const end = new Date(toISOFromBR(endDateBR));

  return date >= start && date <= end;
}

/**
 * Soma segura de array de números (ignora null/undefined)
 */
export function sum(values: (number | null | undefined)[]): number {
  return values.reduce<number>((acc, val) => acc + (val ?? 0), 0);
}

/**
 * Adiciona dias a uma data DD/MM/YYYY
 */
export function addDays(dateBR: string, days: number): string {
  const iso = toISOFromBR(dateBR);
  const date = new Date(iso);
  date.setDate(date.getDate() + days);
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  
  return `${day}/${month}/${year}`;
}

/**
 * Adiciona meses a uma data DD/MM/YYYY
 */
export function addMonths(dateBR: string, months: number): string {
  const iso = toISOFromBR(dateBR);
  const date = new Date(iso);
  date.setMonth(date.getMonth() + months);
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  
  return `${day}/${month}/${year}`;
}

/**
 * Gera os últimos N meses no formato AAAA-MM
 */
export function getLastMonths(n: number): string[] {
  const months: string[] = [];
  const now = new Date();

  for (let i = 0; i < n; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    months.push(`${year}-${month}`);
  }

  return months.reverse();
}

const EMAIL_MASK = /(^.).+(@.+$)/;

function maskEmail(email: string): string {
  if (!EMAIL_MASK.test(email)) {
    return "***";
  }
  return email.replace(EMAIL_MASK, (_match, firstChar: string, domain: string) => `${firstChar}***${domain}`);
}

function maskDocument(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 4) {
    return "***";
  }
  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function maskName(name: string): string {
  if (name.length <= 2) {
    return "**";
  }
  return `${name[0]}${"*".repeat(Math.max(1, name.length - 2))}${name[name.length - 1]}`;
}

export function maskPIIValue(key: string, value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const normalizedKey = key.toLowerCase();
  if (normalizedKey.includes("email")) {
    return maskEmail(value);
  }
  if (normalizedKey.includes("cpf") || normalizedKey.includes("cnpj") || normalizedKey.includes("doc")) {
    return maskDocument(value);
  }
  if (normalizedKey.includes("telefone") || normalizedKey.includes("phone")) {
    return maskDocument(value);
  }
  if (normalizedKey.includes("nome") || normalizedKey.includes("name")) {
    return maskName(value);
  }
  return value;
}

export function scrubPII<T extends Record<string, any>>(payload: T): Record<string, unknown> {
  return Object.entries(payload).reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      acc[key] = scrubPII(value as Record<string, unknown>);
      return acc;
    }

    if (Array.isArray(value)) {
      acc[key] = value.map((item, index) =>
        typeof item === "object" && item !== null
          ? scrubPII(item as Record<string, unknown>)
          : maskPIIValue(`${key}[${index}]`, item)
      );
      return acc;
    }

    acc[key] = maskPIIValue(key, value);
    return acc;
  }, {});
}
