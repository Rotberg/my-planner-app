import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * On-device replacement for the old Supabase tables. Each table is a JSON
 * array in AsyncStorage under `db:<table>`. Writes to a table are serialised
 * so quick successive changes can't overwrite each other, and write failures
 * throw so callers can tell the user.
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

async function read(table: TableName): Promise<Row[]> {
  const raw = await AsyncStorage.getItem(storageKey(table));
  if (raw == null) {
    const seed = SEEDS[table];
    if (!seed) return [];
    const now = new Date().toISOString();
    const rows = seed.map((name) => ({ id: newId(), name, created_at: now }));
    await AsyncStorage.setItem(storageKey(table), JSON.stringify(rows));
    return rows;
  }
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

// Per-table write queue.
const queues = new Map<TableName, Promise<unknown>>();

function mutate<T>(table: TableName, fn: (rows: Row[]) => { rows: Row[]; result: T }): Promise<T> {
  const prev = queues.get(table) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      const current = await read(table);
      const { rows, result } = fn(current);
      await AsyncStorage.setItem(storageKey(table), JSON.stringify(rows));
      return result;
    });
  queues.set(table, next);
  return next;
}

/** All rows, optionally filtered and sorted. Waits for pending writes. */
export async function selectRows<T extends Row = Row>(
  table: TableName,
  opts: { where?: (row: T) => boolean; orderBy?: keyof T & string; ascending?: boolean } = {}
): Promise<T[]> {
  // Read through the queue so the first-read seed can't race a write.
  const pending = (queues.get(table) ?? Promise.resolve()).catch(() => {}).then(() => read(table));
  queues.set(table, pending);
  let rows = (await pending) as T[];
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

/** Inserts rows, assigning `id` and `created_at`. Returns the stored rows. */
export function insertRows<T extends Row = Row>(
  table: TableName,
  rows: Omit<T, 'id' | 'created_at'>[]
): Promise<T[]> {
  const now = new Date().toISOString();
  const created = rows.map((r) => ({ ...r, id: newId(), created_at: now })) as unknown as T[];
  return mutate(table, (current) => ({ rows: [...current, ...created], result: created }));
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

/** Deletes matching rows, and their child rows where a cascade is defined. */
export async function deleteRows(table: TableName, where: (row: Row) => boolean): Promise<void> {
  const removed = await mutate(table, (current) => ({
    rows: current.filter((r) => !where(r)),
    result: current.filter(where),
  }));
  const cascade = CASCADES[table];
  if (cascade && removed.length > 0) {
    const ids = new Set(removed.map((r) => r.id));
    await deleteRows(cascade.table, (child) => ids.has(child[cascade.foreignKey]));
  }
}
