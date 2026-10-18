import { fromYMD, toYMD } from './dates';

/** Date-stepping helpers shared by repeating tasks and repeating payments. */

export function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

export function addDays(ymd: string, days: number): string {
  const d = fromYMD(ymd);
  d.setDate(d.getDate() + days);
  return toYMD(d);
}

/**
 * Adds whole months, landing on `day` (default: the date's own day) clamped to
 * the end of shorter months, so Jan 31 → Feb 28 → Mar 31 doesn't drift.
 */
export function addMonthsClamped(ymd: string, months: number, day?: number): string {
  const d = fromYMD(ymd);
  const total = d.getMonth() + months;
  const y = d.getFullYear() + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  return toYMD(new Date(y, m, Math.min(day ?? d.getDate(), daysInMonth(y, m))));
}

/** Whole days from `a` to `b` (negative if `b` is earlier). Safe across DST changes. */
export function daysBetween(a: string, b: string) {
  return Math.round((fromYMD(b).getTime() - fromYMD(a).getTime()) / 86_400_000);
}

/** Whole calendar months from `a` to `b`, ignoring the day. */
export function monthsBetween(a: string, b: string) {
  const da = fromYMD(a);
  const db = fromYMD(b);
  return (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth());
}

/** First and last day of the month containing `ymd`. */
export function monthBounds(ymd: string): { start: string; end: string } {
  const d = fromYMD(ymd);
  const y = d.getFullYear();
  const m = d.getMonth();
  return { start: toYMD(new Date(y, m, 1)), end: toYMD(new Date(y, m, daysInMonth(y, m))) };
}
