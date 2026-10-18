/**
 * Money is stored as integer pence (`amount_minor`) so sums never pick up
 * floating-point errors. GBP only for now; all formatting goes through here.
 */

const formatter = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

/** 1234 → "£12.34". Rounds fractional pence (e.g. from monthly averages). */
export function formatMoney(minor: number): string {
  return formatter.format(Math.round(minor) / 100);
}

/** 1234 → "12.34", for pre-filling an input. */
export function minorToInput(minor: number): string {
  return (minor / 100).toFixed(2);
}

/**
 * Parses what the user typed into pence. Accepts "12", "12.5", "£12.50",
 * "1,200.00". Returns null for anything else, including negatives.
 */
export function parseMoney(input: string): number | null {
  const cleaned = input.trim().replace(/^£/, '').replace(/,/g, '').trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const pounds = Number(match[1]);
  const pence = Number((match[2] ?? '').padEnd(2, '0'));
  const minor = pounds * 100 + pence;
  return Number.isSafeInteger(minor) ? minor : null;
}
