import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * On-device replacement for the old Supabase tables. Each table is a JSON
 * array in AsyncStorage under `db:<table>`.
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
  | 'workout_session_exercises';

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
};

const storageKey = (table: TableName) => `db:${table}`;

export function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Corruption recovery ─────────────────────────────────────────────────────

type CorruptionListener = (table: TableName, backupKey: string) => void;
const corruptionListeners = new Set<CorruptionListener>();

/** Called when a table had to be reset because its stored value was unreadable. */
export function onTableRecovered(listener: CorruptionListener) {
  corruptionListeners.add(listener);
  return () => {
    corruptionListeners.delete(listener);
  };
}

async function quarantine(table: TableName, raw: string) {
  const backupKey = `${storageKey(table)}:corrupt:${Date.now()}`;
  try {
    await AsyncStorage.setItem(backupKey, raw);
  } catch {
    // Keeping the app usable matters more than the backup.
  }
  await AsyncStorage.removeItem(storageKey(table));
  console.warn(`[localDb] ${table} was unreadable; reset it and kept a copy at ${backupKey}`);
  corruptionListeners.forEach((l) => l(table, backupKey));
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

async function read(table: TableName): Promise<Row[]> {
  await ensureSeeded(table);
  const raw = await AsyncStorage.getItem(storageKey(table));
  if (raw == null) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fall through
  }
  await quarantine(table, raw);
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
    const current: Tables = {};
    for (const t of tables) current[t] = await read(t);
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
    const { rows, result } = fn(current[table]!);
    return { changed: { [table]: rows }, result };
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** All rows, optionally filtered and sorted. Waits for pending writes to this table. */
export async function selectRows<T extends Row = Row>(
  table: TableName,
  opts: { where?: (row: T) => boolean; orderBy?: keyof T & string; ascending?: boolean } = {}
): Promise<T[]> {
  await (writeQueues.get(table) ?? Promise.resolve()).catch(() => {});
  let rows = (await read(table)) as T[];
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
export function insertWithChildren<P extends Row = Row, C extends Row = Row>(
  parentTable: TableName,
  parent: NewRow<P>,
  childTable: TableName,
  foreignKey: string,
  children: Omit<NewRow<C>, typeof foreignKey>[]
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

/**
 * Deletes matching rows. Where a cascade is defined, child rows are removed in
 * the same write, along with any children already orphaned by older deletes.
 */
export function deleteRows(table: TableName, where: (row: Row) => boolean): Promise<void> {
  const cascade = CASCADES[table];
  if (!cascade) {
    return mutate(table, (current) => ({ rows: current.filter((r) => !where(r)), result: undefined }));
  }
  return mutateMany([table, cascade.table], (current) => {
    const kept = current[table]!.filter((r) => !where(r));
    const keptIds = new Set(kept.map((r) => r.id));
    const children = current[cascade.table]!.filter((c) => keptIds.has(c[cascade.foreignKey]));
    return { changed: { [table]: kept, [cascade.table]: children }, result: undefined };
  });
}
