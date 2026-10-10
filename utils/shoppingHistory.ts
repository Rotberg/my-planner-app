import { loadData, saveData } from './storage';

export const HISTORY_KEY = 'shopping:itemHistory';

export type HistoryEntry = {
  name: string;
  count: number;
  lastUsed: string;      // ISO
  category?: string;
};

export type Suggestion = {
  name: string;
  source: 'favourite' | 'history' | 'catalog';
  category?: string;
};

const key = (name: string) => name.trim().toLowerCase();

export async function loadHistory(): Promise<HistoryEntry[]> {
  const stored = await loadData(HISTORY_KEY);
  return Array.isArray(stored) ? stored : [];
}

/** Pure: returns history with the added names counted (case-insensitive). */
export function applyRecords(
  current: HistoryEntry[],
  added: { name: string; category?: string }[]
): HistoryEntry[] {
  const map = new Map(current.map((e) => [key(e.name), { ...e }]));
  const now = new Date().toISOString();
  for (const item of added) {
    const k = key(item.name);
    if (!k) continue;
    const existing = map.get(k);
    if (existing) {
      existing.count += 1;
      existing.lastUsed = now;
      if (item.category) existing.category = item.category;
    } else {
      map.set(k, { name: item.name.trim(), count: 1, lastUsed: now, category: item.category });
    }
  }
  return [...map.values()];
}

export async function saveHistory(history: HistoryEntry[]) {
  await saveData(HISTORY_KEY, history);
}

/** Records item names (and their category) and persists the result. */
export async function recordItems(
  current: HistoryEntry[],
  added: { name: string; category?: string }[]
): Promise<HistoryEntry[]> {
  const next = applyRecords(current, added);
  await saveHistory(next);
  return next;
}

/** Merges past entries from saved lists into local history (without persisting). */
export function mergeHistory(
  local: HistoryEntry[],
  remote: { name: string; category: string | null }[]
): HistoryEntry[] {
  const map = new Map(local.map((e) => [key(e.name), { ...e }]));
  for (const r of remote) {
    const k = key(r.name);
    if (!k) continue;
    const existing = map.get(k);
    if (existing) {
      if (!existing.category && r.category) existing.category = r.category;
    } else {
      map.set(k, { name: r.name.trim(), count: 1, lastUsed: '', category: r.category ?? undefined });
    }
  }
  // Remote rows for the same name collapse to one entry; count them.
  const remoteCounts = new Map<string, number>();
  for (const r of remote) remoteCounts.set(key(r.name), (remoteCounts.get(key(r.name)) ?? 0) + 1);
  for (const [k, n] of remoteCounts) {
    const e = map.get(k);
    if (e && !local.some((l) => key(l.name) === k)) e.count = n;
  }
  return [...map.values()];
}

/**
 * Suggestions for a typed name. Prefix matches rank above substring matches;
 * within each, favourites → history (by use count, then recency) → catalog.
 */
export function buildSuggestions(
  query: string,
  opts: {
    favourites: string[];
    history: HistoryEntry[];
    catalog: string[];
    exclude: string[];   // names already on the current list
    limit?: number;
  }
): Suggestion[] {
  const q = key(query);
  if (!q) return [];
  const excluded = new Set(opts.exclude.map(key));
  const historyByKey = new Map(opts.history.map((h) => [key(h.name), h]));

  const sortedHistory = [...opts.history].sort(
    (a, b) => b.count - a.count || b.lastUsed.localeCompare(a.lastUsed)
  );

  const ordered: Suggestion[] = [
    ...opts.favourites.map((name) => ({ name, source: 'favourite' as const })),
    ...sortedHistory.map((h) => ({ name: h.name, source: 'history' as const })),
    ...opts.catalog.map((name) => ({ name, source: 'catalog' as const })),
  ];

  const seen = new Set<string>();
  const prefix: Suggestion[] = [];
  const contains: Suggestion[] = [];
  for (const s of ordered) {
    const k = key(s.name);
    if (seen.has(k) || k === q || excluded.has(k)) continue;
    const withCategory = { ...s, category: historyByKey.get(k)?.category };
    if (k.startsWith(q)) {
      seen.add(k);
      prefix.push(withCategory);
    } else if (k.includes(q)) {
      seen.add(k);
      contains.push(withCategory);
    }
  }
  return [...prefix, ...contains].slice(0, opts.limit ?? 6);
}
