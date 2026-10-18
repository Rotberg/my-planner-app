import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * On-device database. Each table is a JSON array in AsyncStorage under
 * `db:<table>`.
 *
 * - Writes are serialised per table, so quick successive changes can't
 *   overwrite each other. Reads only wait for pending writes, not other reads.
 * - Writes that touch several tables (a parent with its children, or a
 *   cascading delete) are saved in a single `multiSet`, so they can't be left
 *   half-done.
 * - A table whose stored value can't be parsed is moved aside to a backup key
 *   and treated as empty, so one corrupt value can't break the feature forever.
 * - Write failures throw so callers can tell the user.
 */

export type TableName =
  | 'catalog_items'
  | 'favorite_items'
  | 'shopping_lists'
  | 'shopping_list_items'
  | 'health_stats'
  | 'exercise_catalog'
  | 'workout_routines'
  | 'workout_routine_exercises'
  | 'workout_sessions'
  | 'workout_session_exercises'
  | 'finance_recurring'
  | 'finance_transactions'
  | 'finance_pots'
  | 'finance_pot_entries';

export type Row = { id: string; created_at: string; [key: string]: any };

/** Rows seeded the first time a table is read (same as the old SQL seeds). */
const SEEDS: Partial<Record<TableName, string[]>> = {
  catalog_items: [
    'Rice', 'Eggs', 'Milk', 'Bread', 'Butter', 'Chicken', 'Beef', 'Pasta', 'Tomatoes', 'Onions',
    'Garlic', 'Olive Oil', 'Salt', 'Pepper', 'Sugar', 'Cheese', 'Yoghurt', 'Apples', 'Bananas', 'Potatoes',
  ],
  exercise_catalog: [
    'Bench Press', 'Squat', 'Deadlift', 'Overhead Press', 'Barbell Row', 'Pull-up', 'Push-up', 'Lunge',
    'Bicep Curl', 'Tricep Extension', 'Lat Pulldown', 'Leg Press', 'Plank', 'Sit-up', 'Running',
  ],
};

/** Child tables deleted along with their parent row (like ON DELETE CASCADE). */
const CASCADES: Partial<Record<TableName, { table: TableName; foreignKey: string }>> = {
  shopping_lists: { table: 'shopping_list_items', foreignKey: 'list_id' },
  workout_routines: { table: 'workout_routine_exercises', foreignKey: 'routine_id' },
  workout_sessions: { table: 'workout_session_exercises', foreignKey: 'session_id' },
  finance_pots: { table: 'finance_pot_entries', foreignKey: 'pot_id' },
};

const storageKey = (table: TableName) => `db:${table}`;

export function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Corruption recovery ─────────────────────────────────────────────────────

/** `backupKey` is null when the backup couldn't be saved (e.g. storage full). */
type CorruptionListener = (label: string, backupKey: string | null) => void;
const corruptionListeners = new Set<CorruptionListener>();
// Resets that happen before anyone listens (e.g. during the first screen
// load, before the root layout's effect runs) are delivered on subscribe.
const pendingRecoveries: [string, string | null][] = [];

/** Called when a table had to be reset because its stored value was unreadable. */
export function onTableRecovered(listener: CorruptionListener) {
  corruptionListeners.add(listener);
  pendingRecoveries.splice(0).forEach(([label, key]) => listener(label, key));
  return () => {
    corruptionListeners.delete(listener);
  };
}

/**
 * Moves an unreadable stored value to a backup key and removes it, then tells
 * listeners. `label` is shown to the user (e.g. a table name). Callers must
 * only run this while holding that key's write queue, so a concurrent write
 * can't be deleted and the user isn't alerted twice.
 */
export async function quarantineKey(key: string, label: string, raw: string) {
  const prefix = `${key}:corrupt:`;
  // Keep only the newest backup per key, so repeated corruption (often caused
  // by a full disk) doesn't pile up full copies.
  try {
    const old = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix));
    if (old.length > 0) await AsyncStorage.multiRemove(old);
  } catch {
    // ignore
  }
  let backupKey: string | null = `${prefix}${Date.now()}`;
  try {
    await AsyncStorage.setItem(backupKey, raw);
  } catch {
    // Keeping the app usable matters more than the backup, but don't claim one exists.
    backupKey = null;
  }
  await AsyncStorage.removeItem(key);
  console.warn(`[localDb] ${label} was unreadable and was reset. Backup: ${backupKey ?? 'could not be saved'}`);
  if (corruptionListeners.size === 0) pendingRecoveries.push([label, backupKey]);
  else corruptionListeners.forEach((l) => l(label, backupKey));
}

// ─── Reading ─────────────────────────────────────────────────────────────────

const seeding = new Map<TableName, Promise<void>>();

/** Seeds a table once, the first time it is ever touched. */
function ensureSeeded(table: TableName): Promise<void> {
  const seed = SEEDS[table];
  if (!seed) return Promise.resolve();
  let p = seeding.get(table);
  if (!p) {
    p = (async () => {
      const seededKey = `${storageKey(table)}:seeded`;
      if ((await AsyncStorage.getItem(seededKey)) != null) return;
      if ((await AsyncStorage.getItem(storageKey(table))) == null) {
        const now = new Date().toISOString();
        const rows = seed.map((name) => ({ id: newId(), name, created_at: now }));
        await AsyncStorage.multiSet([
          [storageKey(table), JSON.stringify(rows)],
          [seededKey, '1'],
        ]);
      } else {
        await AsyncStorage.setItem(seededKey, '1');
      }
    })();
    // Allow a retry if seeding failed.
    p.catch(() => seeding.delete(table));
    seeding.set(table, p);
  }
  return p;
}

const CORRUPT = Symbol('corrupt');

/** Parses a stored table. Returns CORRUPT (with the raw value) instead of throwing. */
async function readRaw(table: TableName): Promise<Row[] | { [CORRUPT]: string }> {
  await ensureSeeded(table);
  const raw = await AsyncStorage.getItem(storageKey(table));
  if (raw == null) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fall through
  }
  return { [CORRUPT]: raw };
}

/** Reads a table. Must be called while holding the table's write queue. */
async function readLocked(table: TableName): Promise<Row[]> {
  const result = await readRaw(table);
  if (Array.isArray(result)) return result;
  await quarantineKey(storageKey(table), table.replace(/_/g, ' '), result[CORRUPT]);
  return [];
}

// ─── Write queue ─────────────────────────────────────────────────────────────

const writeQueues = new Map<TableName, Promise<unknown>>();

/** Runs `task` after every pending write to `tables`, and blocks later writes until it finishes. */
function enqueueWrite<T>(tables: TableName[], task: () => Promise<T>): Promise<T> {
  const waits = tables.map((t) => (writeQueues.get(t) ?? Promise.resolve()).catch(() => {}));
  const next = Promise.all(waits).then(task);
  tables.forEach((t) => writeQueues.set(t, next));
  return next;
}

type Tables = Partial<Record<TableName, Row[]>>;

/** Reads `tables`, applies `fn`, and saves every changed table in one multiSet. */
function mutateMany<T>(tables: TableName[], fn: (current: Tables) => { changed: Tables; result: T }): Promise<T> {
  return enqueueWrite(tables, async () => {
    const rows = await Promise.all(tables.map((t) => readLocked(t)));
    const current: Tables = {};
    tables.forEach((t, i) => (current[t] = rows[i]));
    const { changed, result } = fn(current);
    const entries = (Object.keys(changed) as TableName[]).map(
      (t) => [storageKey(t), JSON.stringify(changed[t])] as [string, string]
    );
    if (entries.length > 0) await AsyncStorage.multiSet(entries);
    return result;
  });
}

function mutate<T>(table: TableName, fn: (rows: Row[]) => { rows: Row[]; result: T }): Promise<T> {
  return mutateMany([table], (current) => {
    const before = current[table]!;
    const { rows, result } = fn(before);
    // Unchanged (same array returned): skip the write entirely.
    return { changed: rows === before ? {} : { [table]: rows }, result };
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** All rows, optionally filtered and sorted. Waits for pending writes to this table. */
export async function selectRows<T extends Row = Row>(
  table: TableName,
  opts: { where?: (row: T) => boolean; orderBy?: keyof T & string; ascending?: boolean } = {}
): Promise<T[]> {
  await (writeQueues.get(table) ?? Promise.resolve()).catch(() => {});
  const result = await readRaw(table);
  // Reads run outside the queue. A corrupt table is only reset inside it, so
  // the reset can't delete a write that landed in the meantime.
  let rows = (Array.isArray(result) ? result : await enqueueWrite([table], () => readLocked(table))) as T[];
  if (opts.where) rows = rows.filter(opts.where);
  if (opts.orderBy) {
    const key = opts.orderBy;
    const dir = opts.ascending === false ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }
  return rows;
}

type NewRow<T extends Row> = Omit<T, 'id' | 'created_at'>;

function stamp<T extends Row>(rows: NewRow<T>[]): T[] {
  const now = new Date().toISOString();
  return rows.map((r) => ({ ...r, id: newId(), created_at: now })) as unknown as T[];
}

/** Inserts rows, assigning `id` and `created_at`. Returns the stored rows. */
export function insertRows<T extends Row = Row>(table: TableName, rows: NewRow<T>[]): Promise<T[]> {
  const created = stamp<T>(rows);
  return mutate(table, (current) => ({ rows: [...current, ...created], result: created }));
}

/**
 * Inserts a parent row and its child rows together. Both tables are saved in
 * one write, so a failure can't leave a parent without its children.
 * The child rows get the parent's id in `foreignKey`.
 */
export function insertWithChildren<P extends Row = Row, C extends Row = Row, K extends string = string>(
  parentTable: TableName,
  parent: NewRow<P>,
  childTable: TableName,
  foreignKey: K,
  children: Omit<NewRow<C>, K>[]
): Promise<{ parent: P; children: C[] }> {
  const [createdParent] = stamp<P>([parent]);
  const createdChildren = stamp<C>(
    children.map((c) => ({ ...c, [foreignKey]: createdParent.id })) as NewRow<C>[]
  );
  return mutateMany([parentTable, childTable], (current) => ({
    changed: {
      [parentTable]: [...current[parentTable]!, createdParent],
      [childTable]: [...current[childTable]!, ...createdChildren],
    },
    result: { parent: createdParent, children: createdChildren },
  }));
}

/**
 * Inserts `row` unless a row matching `exists` is already stored. Checked
 * inside the write queue, so a quick double tap can't add it twice.
 * Resolves to the stored row, or null if one already existed.
 */
export function insertRowUnless<T extends Row = Row>(
  table: TableName,
  exists: (row: T) => boolean,
  row: NewRow<T>
): Promise<T | null> {
  return mutate(table, (current) => {
    if ((current as T[]).some(exists)) return { rows: current, result: null };
    const [created] = stamp<T>([row]);
    return { rows: [...current, created], result: created };
  });
}

/**
 * Inserts each of `rows` unless `exists(stored, row)` matches a stored row,
 * all in one write. Resolves to the rows actually added.
 */
export function insertRowsUnless<T extends Row = Row>(
  table: TableName,
  rows: NewRow<T>[],
  exists: (stored: T, row: NewRow<T>) => boolean
): Promise<T[]> {
  return mutate(table, (current) => {
    const fresh = rows.filter((r) => !(current as T[]).some((stored) => exists(stored, r)));
    if (fresh.length === 0) return { rows: current, result: [] };
    const created = stamp<T>(fresh);
    return { rows: [...current, ...created], result: created };
  });
}

/** Inserts a row with this name unless one exists (case-insensitive). */
export function upsertByName(table: TableName, name: string): Promise<void> {
  const key = name.trim().toLowerCase();
  return mutate(table, (current) => {
    if (current.some((r) => String(r.name).trim().toLowerCase() === key)) {
      return { rows: current, result: undefined };
    }
    return {
      rows: [...current, { id: newId(), name: name.trim(), created_at: new Date().toISOString() }],
      result: undefined,
    };
  });
}

/** Applies `patch` to matching rows. */
export function updateRows(table: TableName, where: (row: Row) => boolean, patch: (row: Row) => Partial<Row>) {
  return mutate(table, (current) => {
    let changed = false;
    const rows = current.map((r) => {
      if (!where(r)) return r;
      changed = true;
      return { ...r, ...patch(r) };
    });
    return { rows: changed ? rows : current, result: undefined };
  });
}

/**
 * Deletes matching rows. Where a cascade is defined, the removed rows' children
 * are deleted in the same write. Other child rows are never touched, even if
 * their parent is missing (e.g. after a parent table was reset).
 */
export function deleteRows(table: TableName, where: (row: Row) => boolean): Promise<void> {
  const cascade = CASCADES[table];
  if (!cascade) {
    return mutate(table, (current) => {
      const kept = current.filter((r) => !where(r));
      return { rows: kept.length === current.length ? current : kept, result: undefined };
    });
  }
  return mutateMany([table, cascade.table], (current) => {
    const parents = current[table]!;
    const removedIds = new Set(parents.filter(where).map((r) => r.id));
    if (removedIds.size === 0) return { changed: {}, result: undefined };
    const kept = parents.filter((r) => !removedIds.has(r.id));
    const children = current[cascade.table]!;
    const keptChildren = children.filter((c) => !removedIds.has(c[cascade.foreignKey]));
    const changed: Tables = { [table]: kept };
    if (keptChildren.length !== children.length) changed[cascade.table] = keptChildren;
    return { changed, result: undefined };
  });
}
