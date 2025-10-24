/**
 * Converte data de YYYY-MM-DD para DD/MM/YYYY
 */
export function formatToBR(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  
  const [year, month, day] = dateStr.split('-');
  if (!year || !month || !day) return dateStr;
  
  return `${day}/${month}/${year}`;
}

/**
 * Converte data de DD/MM/YYYY para YYYY-MM-DD
 */
export function formatFromBR(dateStr: string): string {
  const [day, month, year] = dateStr.split('/');
  if (!day || !month || !year) return dateStr;
  
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * Formata período YYYY-MM para "Mês YYYY" em português
 */
export function formatPeriodToBR(period: string): string {
  if (!period) return '-';
  
  const [year, month] = period.split('-');
  if (!year || !month) return period;
  
  const monthNames = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];
  
  const monthIndex = parseInt(month, 10) - 1;
  const monthName = monthNames[monthIndex] || month;
  
  return `${monthName} ${year}`;
}

/**
 * Retorna o período atual no formato YYYY-MM
 */
export function getCurrentPeriod(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Retorna início e fim do mês para um período YYYY-MM
 */
export function getPeriodRange(period: string): { from: string; to: string } {
  const [year, month] = period.split('-');
  const monthNum = parseInt(month, 10);
  const yearNum = parseInt(year, 10);
  
  // Primeiro dia do mês
  const from = `${year}-${month}-01`;
  
  // Último dia do mês
  const lastDay = new Date(yearNum, monthNum, 0).getDate();
  const to = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
  
  return { from, to };
}
