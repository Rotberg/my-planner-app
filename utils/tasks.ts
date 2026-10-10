import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';
import { cancelEventNotification, scheduleEventNotification } from './notifications';
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

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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

let migrationPromise: Promise<void> | null = null;

/** One-time merge of v1 tasks + Planner events into the unified store. */
function migrateIfNeeded(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      const version = await loadData(SCHEMA_VERSION_KEY);
      if (typeof version === 'number' && version >= SCHEMA_VERSION) return;

      const rawTasks: any[] = (await loadData(TASKS_KEY)) ?? [];
      const rawEvents: any[] = (await loadData(LEGACY_EVENTS_KEY)) ?? [];
      const merged = [...rawTasks.map(normalizeLegacyTask), ...rawEvents.map(eventToTask)];

      // Use AsyncStorage directly: the shared storage helpers swallow errors,
      // and old events must only be deleted once the merged list is safely saved.
      await AsyncStorage.setItem(TASKS_KEY, JSON.stringify(merged));
      const check = await AsyncStorage.getItem(TASKS_KEY);
      const saved = check ? JSON.parse(check) : null;
      if (!Array.isArray(saved) || saved.length !== merged.length) {
        throw new Error('Merged tasks did not save correctly');
      }
      await AsyncStorage.setItem(SCHEMA_VERSION_KEY, JSON.stringify(SCHEMA_VERSION));
      await AsyncStorage.removeItem(LEGACY_EVENTS_KEY);
    })().catch((e) => {
      // Leave planner_events and the schema version untouched so the next load retries.
      migrationPromise = null;
      console.error('Task migration failed:', e);
    });
  }
  return migrationPromise;
}

export async function loadTasks(): Promise<Task[]> {
  await migrateIfNeeded();
  const stored: any[] = (await loadData(TASKS_KEY)) ?? [];
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

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Shared task store for the Tasks and Planner tabs. Reloads whenever the
 * screen gains focus so edits made in one tab show up in the other.
 */
export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const tasksRef = useRef<Task[]>([]);

  const commit = useCallback(async (next: Task[]) => {
    tasksRef.current = next;
    setTasks(next);
    await saveData(TASKS_KEY, next);
  }, []);

  const reload = useCallback(async () => {
    const loaded = await loadTasks();
    tasksRef.current = loaded;
    setTasks(loaded);

    // Undone daily repeats from previous days roll forward to today, so a
    // missed day doesn't leave the routine stuck in the past.
    const today = todayYMD();
    const stale = (t: Task) => t.recurrence === 'daily' && !t.done && t.date < today;
    const toRoll = loaded.filter(stale);
    if (toRoll.length === 0) return;

    const notificationIds = new Map<string, string | null>();
    for (const t of toRoll) {
      notificationIds.set(t.id, await scheduleFor({ ...t, date: today }));
    }
    // Apply to the *current* list, not the snapshot, so edits made while
    // notifications were being scheduled aren't overwritten.
    await commit(
      tasksRef.current.map((t) =>
        notificationIds.has(t.id) && stale(t)
          ? { ...t, date: today, notificationId: notificationIds.get(t.id) ?? null }
          : t
      )
    );
  }, [commit]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const addTask = useCallback(
    async (input: TaskInput) => {
      const task: Task = {
        ...input,
        id: newId(),
        done: false,
        notificationId: null,
        createdAt: new Date().toISOString(),
      };
      task.notificationId = await scheduleFor(task);
      await commit([task, ...tasksRef.current]);
    },
    [commit]
  );

  const updateTask = useCallback(
    async (id: string, input: TaskInput) => {
      const existing = tasksRef.current.find((t) => t.id === id);
      if (!existing) return;
      await cancelFor(existing);
      const updated: Task = {
        ...existing,
        ...input,
        notificationId: null,
        // A new date starts a new monthly anchor.
        anchorDay: input.date !== existing.date ? undefined : existing.anchorDay,
      };
      updated.notificationId = await scheduleFor(updated);
      await commit(tasksRef.current.map((t) => (t.id === id ? updated : t)));
    },
    [commit]
  );

  const deleteTask = useCallback(
    async (id: string) => {
      const existing = tasksRef.current.find((t) => t.id === id);
      if (existing) await cancelFor(existing);
      await commit(tasksRef.current.filter((t) => t.id !== id));
    },
    [commit]
  );

  /**
   * Toggles done. Completing a recurring task spawns its next instance;
   * un-completing it removes that instance again (unless it's already done).
   */
  const toggleDone = useCallback(
    async (id: string) => {
      const task = tasksRef.current.find((t) => t.id === id);
      if (!task) return;
      const nowDone = !task.done;

      if (nowDone) {
        await cancelFor(task);
        const updated: Task = { ...task, done: true, notificationId: null };
        let spawned: Task | null = null;

        if (task.recurrence !== 'none') {
          const anchorDay = task.anchorDay ?? fromYMD(task.date).getDate();
          // If completed late, skip ahead so the next instance isn't already overdue.
          const today = todayYMD();
          let nextDate = nextOccurrence(task.date, task.recurrence, anchorDay);
          while (nextDate < today) nextDate = nextOccurrence(nextDate, task.recurrence, anchorDay);

          const existing = tasksRef.current.find(
            (t) => t.id !== id && t.title === task.title && t.date === nextDate && t.recurrence === task.recurrence
          );
          if (existing) {
            updated.nextId = existing.id;
          } else {
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
        const next = tasksRef.current.map((t) => (t.id === id ? updated : t));
        await commit(spawned ? [spawned, ...next] : next);
      } else {
        const updated: Task = { ...task, done: false, nextId: undefined, notificationId: null };
        updated.notificationId = await scheduleFor(updated);
        // Remove the instance this tick created, so the task isn't duplicated.
        const spawned = task.nextId ? tasksRef.current.find((t) => t.id === task.nextId) : undefined;
        const removeSpawned = spawned && !spawned.done;
        if (removeSpawned) await cancelFor(spawned);
        await commit(
          tasksRef.current
            .filter((t) => !(removeSpawned && t.id === spawned!.id))
            .map((t) => (t.id === id ? updated : t))
        );
      }
    },
    [commit]
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
