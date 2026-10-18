/** Local-calendar date helpers. Dates are stored as 'YYYY-MM-DD' in local time, never UTC. */

export function toYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parse YYYY-MM-DD as a local date (not UTC). */
export function fromYMD(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayYMD() {
  return toYMD(new Date());
}

/** Returns 42 dates (6 weeks) starting from the Sunday of the week that contains the 1st of the month. */
export function buildMonthGrid(year: number, month: number): Date[] {
  const firstOfMonth = new Date(year, month, 1);
  const startDow = firstOfMonth.getDay(); // 0 = Sun
  const gridStart = new Date(year, month, 1 - startDow);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

/** Weekday headers for `buildMonthGrid` (which starts on Sunday). */
export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Thu, 23 Oct", or "Thu, 23 Oct 2026" with `withYear`. */
export function formatDay(ymd: string, withYear = false): string {
  return fromYMD(ymd).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}
