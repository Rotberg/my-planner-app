import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { cancelEventNotification, scheduleEventNotification } from './notifications';
import { fromYMD, toYMD, todayYMD } from './dates';
import { newId } from './localDb';
import { loadData, saveData } from './storage';

// ─── Types ───────────────────────────────────────────────────────────────────

export type Priority = 'low' | 'medium' | 'high';
export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly';

/**
 * The single item type used by both the Tasks tab and the Planner.
 * (Planner "events" are just tasks with a start time.)
 */
export type Task = {
  id: string;
  title: string;
  notes?: string;
  date: string;          // YYYY-MM-DD (local)
  startTime?: string;    // HH:MM (24h)
  endTime?: string;      // HH:MM (24h)
  priority: Priority;
  recurrence: Recurrence;
  tags: string[];
  done: boolean;
  notificationId?: string | null;
  createdAt: string;     // ISO
  /** Day of month a monthly series repeats on (so Jan 31 → Feb 28 → Mar 31). */
  anchorDay?: number;
  /** Id of the next instance spawned when this one was ticked off. */
  nextId?: string;
};

/** Fields the add/edit form controls. */
export type TaskInput = Pick<
  Task,
  'title' | 'notes' | 'date' | 'startTime' | 'endTime' | 'priority' | 'recurrence' | 'tags'
>;

// ─── Constants ───────────────────────────────────────────────────────────────

export const TASKS_KEY = 'tasks';
const SCHEMA_VERSION_KEY = 'tasks:schemaVersion';
const LEGACY_EVENTS_KEY = 'planner_events';
const SCHEMA_VERSION = 2;
export const TIME_FORMAT_KEY = 'tasks:timeFormat24h';

/** Tag that makes a task count towards the daily progress bar. */
export const MUST_DO_TAG = 'Must Do';
export const MUST_DO_COLOR = { bg: '#ccfbf1', border: '#5eead4', text: '#0f766e' };

export const PRIORITY_OPTIONS: { label: string; value: Priority; color: string }[] = [
  { label: 'Low', value: 'low', color: '#84a98c' },
  { label: 'Medium', value: 'medium', color: '#d4a017' },
  { label: 'High', value: 'high', color: '#c44569' },
];

export const RECURRENCE_OPTIONS: { label: string; value: Recurrence }[] = [
  { label: 'Once', value: 'none' },
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
];

export const PRESET_TAGS = ['Daily', 'Health', 'Work', 'Personal', 'Appointment', 'Exercise'];

const TAG_PALETTE = [
  { bg: '#eef0eb', border: '#cdd5c2', text: '#5a6a4a' },
  { bg: '#f5ebd4', border: '#e6d29a', text: '#8a6914' },
  { bg: '#f1d9d9', border: '#dcb0b0', text: '#8b3737' },
];

export function getTagColor(tag: string) {
  if (tag === MUST_DO_TAG) return MUST_DO_COLOR;
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) & 0xffffffff;
  }
  return TAG_PALETTE[Math.abs(hash) % TAG_PALETTE.length];
}

export function priorityColor(value: Priority) {
  return PRIORITY_OPTIONS.find((p) => p.value === value)?.color ?? '#6b7280';
}

export function isMustDo(task: Pick<Task, 'tags'>) {
  return task.tags.includes(MUST_DO_TAG);
}

// ─── Date helpers ────────────────────────────────────────────────────────────

export { fromYMD, toYMD, todayYMD };

export function formatTime(hhmm: string | undefined, is24Hour = false): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const mm = String(m).padStart(2, '0');
  if (is24Hour) return `${String(h).padStart(2, '0')}:${mm}`;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${mm} ${period}`;
}

export function formatTimeRange(task: Pick<Task, 'startTime' | 'endTime'>, is24Hour = false) {
  if (!task.startTime) return '';
  return task.endTime
    ? `${formatTime(task.startTime, is24Hour)} – ${formatTime(task.endTime, is24Hour)}`
    : formatTime(task.startTime, is24Hour);
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Next date for a recurring task. Monthly repeats on `anchorDay` (default: the
 * date's own day), clamped to the end of shorter months without drifting.
 */
export function nextOccurrence(ymd: string, recurrence: Recurrence, anchorDay?: number): string {
  const d = fromYMD(ymd);
  if (recurrence === 'daily') d.setDate(d.getDate() + 1);
  else if (recurrence === 'weekly') d.setDate(d.getDate() + 7);
  else if (recurrence === 'monthly') {
    const day = anchorDay ?? d.getDate();
    const y = d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear();
    const m = (d.getMonth() + 1) % 12;
    return toYMD(new Date(y, m, Math.min(day, daysInMonth(y, m))));
  }
  return toYMD(d);
}

/**
 * Whether a task falls on a date.
 * - 'real': the stored instance is on that date.
 * - 'projected': a future repeat of an undone recurring task (read-only preview).
 */
export function occursOn(task: Task, ymd: string): 'real' | 'projected' | null {
  if (task.date === ymd) return 'real';
  if (task.recurrence === 'none' || task.done || ymd <= task.date) return null;

  const start = fromYMD(task.date);
  const target = fromYMD(ymd);
  if (task.recurrence === 'daily') return 'projected';
  if (task.recurrence === 'weekly') {
    const diffDays = Math.round((target.getTime() - start.getTime()) / 86_400_000);
    return diffDays % 7 === 0 ? 'projected' : null;
  }
  if (task.recurrence === 'monthly') {
    const anchor = task.anchorDay ?? start.getDate();
    const day = Math.min(anchor, daysInMonth(target.getFullYear(), target.getMonth()));
    return target.getDate() === day ? 'projected' : null;
  }
  return null;
}

/** Sort: timed tasks by start time, then untimed; done tasks last. */
export function compareTasks(a: Task, b: Task) {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
  if (a.startTime) return -1;
  if (b.startTime) return 1;
  return a.createdAt.localeCompare(b.createdAt);
}

export type DatedTask = { task: Task; projected: boolean };

/** All tasks on a date, including projected repeats, sorted. */
export function tasksForDate(tasks: Task[], ymd: string): DatedTask[] {
  const out: DatedTask[] = [];
  for (const task of tasks) {
    const kind = occursOn(task, ymd);
    if (kind) out.push({ task, projected: kind === 'projected' });
  }
  return out.sort((a, b) => compareTasks(a.task, b.task));
}

/** Today's Must Do completion. Only tasks actually dated today count. */
export function dailyProgress(tasks: Task[], ymd = todayYMD()) {
  const mustDo = tasks.filter((t) => t.date === ymd && isMustDo(t));
  const done = mustDo.filter((t) => t.done).length;
  return {
    done,
    total: mustDo.length,
    percent: mustDo.length === 0 ? 0 : Math.round((done / mustDo.length) * 100),
  };
}

// ─── Migration ───────────────────────────────────────────────────────────────

/** Converts a v1 task (ISO dueDate / dueTime) into the current shape. */
function normalizeLegacyTask(raw: any): Task {
  const date =
    typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)
      ? raw.date
      : raw.dueDate
      ? toYMD(new Date(raw.dueDate))
      : todayYMD();
  return {
    id: String(raw.id ?? newId()),
    title: String(raw.title ?? ''),
    notes: raw.notes || undefined,
    date,
    startTime: raw.startTime || raw.dueTime || undefined,
    endTime: raw.endTime || undefined,
    priority: raw.priority ?? 'medium',
    recurrence: raw.recurrence ?? 'none',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    done: !!raw.done,
    notificationId: raw.notificationId ?? null,
    createdAt: raw.createdAt ?? new Date(Number(String(raw.id).split('-')[0]) || Date.now()).toISOString(),
    anchorDay: typeof raw.anchorDay === 'number' ? raw.anchorDay : undefined,
    nextId: typeof raw.nextId === 'string' ? raw.nextId : undefined,
  };
}

/** Converts an old Planner event into a task. */
function eventToTask(ev: any): Task {
  return {
    id: `event-${ev.id}`,
    title: String(ev.title ?? ''),
    notes: ev.notes || undefined,
    date: ev.date,
    startTime: ev.time || undefined,
    endTime: undefined,
    priority: 'medium',
    recurrence: 'none',
    tags: [],
    done: false,
    notificationId: ev.notificationId ?? null,
    createdAt: new Date(Number(ev.id) || Date.now()).toISOString(),
  };
}

// ─── Strict storage ──────────────────────────────────────────────────────────
// The shared storage helpers swallow errors. Tasks use AsyncStorage directly so
// a failed read is never mistaken for "no tasks" and a failed write is reported.

async function readJson(key: string): Promise<any> {
  const raw = await AsyncStorage.getItem(key);
  return raw == null ? null : JSON.parse(raw);
}

async function writeTasks(tasks: Task[]) {
  await AsyncStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

// ─── Migration ───────────────────────────────────────────────────────────────

let migrationPromise: Promise<void> | null = null;

/** One-time merge of v1 tasks + Planner events into the unified store. */
function migrateIfNeeded(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      const version = await readJson(SCHEMA_VERSION_KEY);
      if (typeof version === 'number' && version >= SCHEMA_VERSION) return;

      // Strict reads: if either read fails, the migration throws and retries
      // next time instead of overwriting tasks with a partial list.
      const rawTasks = (await readJson(TASKS_KEY)) ?? [];
      const rawEvents = (await readJson(LEGACY_EVENTS_KEY)) ?? [];
      if (!Array.isArray(rawTasks) || !Array.isArray(rawEvents)) {
        throw new Error('Stored tasks or events are not a list');
      }

      // Idempotent: if a previous run saved the merge but died before marking
      // it done, events already present (same id) aren't added twice.
      const tasks = rawTasks.map(normalizeLegacyTask);
      const ids = new Set(tasks.map((t) => t.id));
      const merged = [...tasks, ...rawEvents.map(eventToTask).filter((t) => !ids.has(t.id))];

      // Old events are only deleted once the merged list is saved and verified.
      await writeTasks(merged);
      const saved = await readJson(TASKS_KEY);
      if (!Array.isArray(saved) || saved.length !== merged.length) {
        throw new Error('Merged tasks did not save correctly');
      }
      await AsyncStorage.setItem(SCHEMA_VERSION_KEY, JSON.stringify(SCHEMA_VERSION));
      await AsyncStorage.removeItem(LEGACY_EVENTS_KEY);
    })().catch((e) => {
      // Leave planner_events and the schema version untouched so the next load retries.
      migrationPromise = null;
      throw e;
    });
  }
  return migrationPromise;
}

/** Loads all tasks. Throws if storage can't be read. */
export async function loadTasks(): Promise<Task[]> {
  await migrateIfNeeded();
  const stored = (await readJson(TASKS_KEY)) ?? [];
  if (!Array.isArray(stored)) throw new Error('Stored tasks are not a list');
  return stored.map(normalizeLegacyTask);
}

// ─── Notifications ───────────────────────────────────────────────────────────

async function scheduleFor(task: Task): Promise<string | null> {
  if (!task.startTime || task.done) return null;
  try {
    return await scheduleEventNotification(task.title, task.notes ?? '', task.date, task.startTime);
  } catch (e) {
    console.error('Failed to schedule notification:', e);
    return null;
  }
}

async function cancelFor(task: Task) {
  if (!task.notificationId) return;
  try {
    await cancelEventNotification(task.notificationId);
  } catch (e) {
    console.error('Failed to cancel notification:', e);
  }
}

// ─── Operation queue ─────────────────────────────────────────────────────────
// Every task operation, from any screen, runs one at a time and starts from
// what's in storage. A double-tap or a tick during a reload therefore can't
// act on stale data or overwrite another change.

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(op: () => Promise<T>): Promise<T> {
  const run = queue.catch(() => {}).then(op);
  queue = run;
  return run;
}

/** Undone daily repeats from earlier days, moved to today. */
async function rollDailyForward(tasks: Task[]): Promise<Task[] | null> {
  const today = todayYMD();
  const stale = tasks.filter((t) => t.recurrence === 'daily' && !t.done && t.date < today);
  if (stale.length === 0) return null;
  const moved = new Map<string, Task>();
  for (const t of stale) {
    const m: Task = { ...t, date: today, notificationId: null };
    m.notificationId = await scheduleFor(m);
    moved.set(t.id, m);
  }
  return tasks.map((t) => moved.get(t.id) ?? t);
}

/**
 * The upcoming instances a repeating task created (following `nextId`), that
 * aren't done yet. Used to delete a whole series.
 */
function undoneSuccessors(tasks: Task[], task: Task): Task[] {
  const out: Task[] = [];
  const seen = new Set<string>([task.id]);
  let nextId = task.nextId;
  while (nextId && !seen.has(nextId)) {
    seen.add(nextId);
    const next = tasks.find((t) => t.id === nextId);
    if (!next) break;
    if (!next.done) out.push(next);
    nextId = next.nextId;
  }
  return out;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Shared task store for the Tasks and Planner tabs. Reloads whenever the
 * screen gains focus so edits made in one tab show up in the other.
 *
 * Mutations resolve to `true` when saved. On failure they show an alert,
 * restore the on-screen list from storage, and resolve to `false`.
 */
export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);

  /** Runs a queued read-modify-write. `fn` returns the new list, or null for no change. */
  const mutate = useCallback(
    (fn: (current: Task[]) => Promise<Task[] | null>): Promise<boolean> =>
      enqueue(async () => {
        try {
          const current = await loadTasks();
          const next = await fn(current);
          if (next) await writeTasks(next);
          setTasks(next ?? current);
          return true;
        } catch (e) {
          console.error('Task save failed:', e);
          Alert.alert('Could not save', 'Your change was not saved. Your device storage may be full.');
          try {
            setTasks(await loadTasks());
          } catch {
            // Keep what's on screen if storage can't be read either.
          }
          return false;
        }
      }),
    []
  );

  const reload = useCallback(async () => {
    await enqueue(async () => {
      try {
        const loaded = await loadTasks();
        const rolled = await rollDailyForward(loaded);
        if (rolled) await writeTasks(rolled);
        setTasks(rolled ?? loaded);
      } catch (e) {
        console.error('Failed to load tasks:', e);
      }
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const addTask = useCallback(
    (input: TaskInput) =>
      mutate(async (current) => {
        const task: Task = {
          ...input,
          id: newId(),
          done: false,
          notificationId: null,
          createdAt: new Date().toISOString(),
        };
        task.notificationId = await scheduleFor(task);
        return [task, ...current];
      }),
    [mutate]
  );

  const updateTask = useCallback(
    (id: string, input: TaskInput) =>
      mutate(async (current) => {
        const existing = current.find((t) => t.id === id);
        if (!existing) return null;
        await cancelFor(existing);
        const updated: Task = {
          ...existing,
          ...input,
          notificationId: null,
          // A new date starts a new monthly anchor.
          anchorDay: input.date !== existing.date ? undefined : existing.anchorDay,
        };
        updated.notificationId = await scheduleFor(updated);
        return current.map((t) => (t.id === id ? updated : t));
      }),
    [mutate]
  );

  /**
   * Deletes a task. For a repeating task this also deletes the upcoming
   * instances it created, so the series stops. Completed instances are kept.
   */
  const deleteTask = useCallback(
    (id: string) =>
      mutate(async (current) => {
        const existing = current.find((t) => t.id === id);
        if (!existing) return null;
        const doomed = [existing, ...(existing.recurrence !== 'none' ? undoneSuccessors(current, existing) : [])];
        for (const t of doomed) await cancelFor(t);
        const ids = new Set(doomed.map((t) => t.id));
        return current.filter((t) => !ids.has(t.id));
      }),
    [mutate]
  );

  /**
   * Toggles done. Completing a recurring task spawns its next instance;
   * un-completing it removes that instance again (unless it's already done).
   * Only an instance this tick created is ever removed.
   */
  const toggleDone = useCallback(
    (id: string) =>
      mutate(async (current) => {
        const task = current.find((t) => t.id === id);
        if (!task) return null;

        if (!task.done) {
          await cancelFor(task);
          const updated: Task = { ...task, done: true, notificationId: null, nextId: undefined };
          let spawned: Task | null = null;

          if (task.recurrence !== 'none') {
            const anchorDay = task.anchorDay ?? fromYMD(task.date).getDate();
            // If completed late, skip ahead so the next instance isn't already overdue.
            const today = todayYMD();
            let nextDate = nextOccurrence(task.date, task.recurrence, anchorDay);
            while (nextDate < today) nextDate = nextOccurrence(nextDate, task.recurrence, anchorDay);

            // An identical upcoming instance already exists: don't spawn a
            // duplicate, and don't link to it (it isn't ours to remove later).
            const alreadyThere = current.some(
              (t) => t.id !== id && t.title === task.title && t.date === nextDate && t.recurrence === task.recurrence
            );
            if (!alreadyThere) {
              spawned = {
                ...task,
                id: newId(),
                date: nextDate,
                done: false,
                notificationId: null,
                nextId: undefined,
                anchorDay,
                createdAt: new Date().toISOString(),
              };
              spawned.notificationId = await scheduleFor(spawned);
              updated.nextId = spawned.id;
            }
          }
          const next = current.map((t) => (t.id === id ? updated : t));
          return spawned ? [spawned, ...next] : next;
        }

        const updated: Task = { ...task, done: false, nextId: undefined, notificationId: null };
        updated.notificationId = await scheduleFor(updated);
        // Remove the instance this tick created, so the task isn't duplicated.
        const spawned = task.nextId ? current.find((t) => t.id === task.nextId) : undefined;
        const removeId = spawned && !spawned.done ? spawned.id : null;
        if (spawned && removeId) await cancelFor(spawned);
        return current.filter((t) => t.id !== removeId).map((t) => (t.id === id ? updated : t));
      }),
    [mutate]
  );

  return { tasks, reload, addTask, updateTask, deleteTask, toggleDone };
}

/** Shared 12h/24h preference. */
export function useTimeFormat() {
  const [is24Hour, setIs24Hour] = useState(false);
  useFocusEffect(
    useCallback(() => {
      loadData(TIME_FORMAT_KEY).then((stored) => {
        if (typeof stored === 'boolean') setIs24Hour(stored);
      });
    }, [])
  );
  const toggle = useCallback(() => {
    setIs24Hour((prev) => {
      saveData(TIME_FORMAT_KEY, !prev);
      return !prev;
    });
  }, []);
  return { is24Hour, toggle24Hour: toggle };
}
