import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import TaskForm from '../components/TaskForm';
import { loadData, saveData } from '../utils/storage';
import { Row, selectRows } from '../utils/localDb';
import {
  DatedTask,
  formatTimeRange,
  fromYMD,
  getTagColor,
  isMustDo,
  MUST_DO_TAG,
  priorityColor,
  Task,
  TaskInput,
  tasksForDate,
  toYMD,
  useTasks,
  useTimeFormat,
} from '../utils/tasks';
import { useTheme } from '../utils/theme';

const HEIGHT_STORAGE_KEY = 'health_user_height_cm';
const FILTERS_STORAGE_KEY = 'planner:filters';

type WorkoutSession = {
  id: string;
  name: string | null;
  performed_at: string;     // YYYY-MM-DD
  exercise_count: number;
};

type HealthStatRow = {
  id: string;
  recorded_at: string;      // YYYY-MM-DD
  weight: number | null;
  waist: number | null;
  chest: number | null;
  hips: number | null;
  arms: number | null;
  thighs: number | null;
  notes: string | null;
};

type FilterKey = 'tasks' | 'repeating' | 'daily' | 'mustdo' | 'workouts' | 'health';

/** Independent on/off filters. Daily repeats are off by default to avoid clutter. */
const FILTERS: { key: FilterKey; label: string; color: string; defaultOn: boolean }[] = [
  { key: 'tasks',     label: 'Tasks',     color: '#6366f1', defaultOn: true },  // indigo
  { key: 'repeating', label: 'Repeating', color: '#d4a017', defaultOn: true },  // gold
  { key: 'daily',     label: 'Daily',     color: '#84a98c', defaultOn: false }, // sage
  { key: 'mustdo',    label: 'Must Do',   color: '#0d9488', defaultOn: true },  // teal
  { key: 'workouts',  label: 'Workouts',  color: '#c44569', defaultOn: true },  // rose
  { key: 'health',    label: 'Health',    color: '#0ea5e9', defaultOn: true },  // sky
];

type FilterState = Record<FilterKey, boolean>;

const DEFAULT_FILTERS = Object.fromEntries(FILTERS.map((f) => [f.key, f.defaultOn])) as FilterState;

const DOT_COLORS = { task: '#6366f1', workout: '#c44569', health: '#0ea5e9' };

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Returns 42 dates (6 weeks) starting from the Sunday of the week that contains the 1st of the month. */
function buildMonthGrid(year: number, month: number): Date[] {
  const firstOfMonth = new Date(year, month, 1);
  const startDow = firstOfMonth.getDay(); // 0 = Sun
  const gridStart = new Date(year, month, 1 - startDow);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

function bmi(weightKg: number, heightCm: number) {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

function bmiCategory(b: number) {
  if (b < 18.5) return 'Underweight';
  if (b < 25) return 'Normal';
  if (b < 30) return 'Overweight';
  return 'Obese';
}

/**
 * Future daily repeats only show when the Daily filter is on (they'd otherwise
 * put a dot on every day). A daily task's real instance (normally today's) still
 * shows under Must Do, so a daily Must Do task never disappears from today.
 * Anything else shows if its type filter or Must Do is on.
 */
function taskPassesFilters(task: Task, projected: boolean, f: FilterState) {
  if (task.recurrence === 'daily') {
    if (f.daily) return true;
    return !projected && f.mustdo && isMustDo(task);
  }
  if (f.mustdo && isMustDo(task)) return true;
  if (task.recurrence === 'none') return f.tasks;
  return f.repeating;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PlannerScreen() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const today = new Date();
  const todayYMD = toYMD(today);

  const [displayYear, setDisplayYear] = useState(today.getFullYear());
  const [displayMonth, setDisplayMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(todayYMD);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

  const { tasks, addTask, updateTask, deleteTask, toggleDone } = useTasks();
  const { is24Hour, toggle24Hour } = useTimeFormat();
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [healthStats, setHealthStats] = useState<HealthStatRow[]>([]);
  const [userHeight, setUserHeight] = useState<number | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  useEffect(() => {
    loadData(FILTERS_STORAGE_KEY).then((stored) => {
      if (stored && typeof stored === 'object') setFilters({ ...DEFAULT_FILTERS, ...stored });
    });
  }, []);

  // Refresh workouts and stats each time the planner is focused, so changes made
  // in the Health screen show up here. (Tasks reload via useTasks.)
  useFocusEffect(
    useCallback(() => {
      loadData(HEIGHT_STORAGE_KEY).then((stored) => {
        if (typeof stored === 'number' && stored > 0) setUserHeight(stored);
        else setUserHeight(null);
      });
      fetchSessions();
      fetchHealthStats();
    }, [])
  );

  async function fetchSessions() {
    try {
      type SessionRow = Row & { name: string | null; performed_at: string; exercise_count?: number };
      const rows = await selectRows<SessionRow>('workout_sessions', { orderBy: 'performed_at', ascending: false });
      // New sessions store their count. Only older ones need the exercise table read.
      const counts = new Map<string, number>();
      if (rows.some((s) => typeof s.exercise_count !== 'number')) {
        const exercises = await selectRows<Row & { session_id: string }>('workout_session_exercises');
        for (const e of exercises) counts.set(e.session_id, (counts.get(e.session_id) ?? 0) + 1);
      }
      setSessions(
        rows.map((s) => ({
          id: s.id,
          name: s.name ?? null,
          performed_at: s.performed_at,
          exercise_count: s.exercise_count ?? counts.get(s.id) ?? 0,
        }))
      );
    } catch (e) {
      console.error('Failed to load workout sessions:', e);
    }
  }

  async function fetchHealthStats() {
    try {
      setHealthStats(
        await selectRows<HealthStatRow & Row>('health_stats', { orderBy: 'recorded_at', ascending: false })
      );
    } catch (e) {
      console.error('Failed to load health stats:', e);
    }
  }

  function toggleFilter(key: FilterKey) {
    setFilters((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveData(FILTERS_STORAGE_KEY, next);
      return next;
    });
  }

  // ── Month navigation ────────────────────────────────────────────────────────

  function prevMonth() {
    if (displayMonth === 0) {
      setDisplayMonth(11);
      setDisplayYear((y) => y - 1);
    } else {
      setDisplayMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (displayMonth === 11) {
      setDisplayMonth(0);
      setDisplayYear((y) => y + 1);
    } else {
      setDisplayMonth((m) => m + 1);
    }
  }

  function goToToday() {
    setDisplayYear(today.getFullYear());
    setDisplayMonth(today.getMonth());
    setSelectedDate(todayYMD);
  }

  // ── Add / edit ──────────────────────────────────────────────────────────────

  function openAdd() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(task: Task) {
    setEditing(task);
    setFormOpen(true);
  }

  /** A projected repeat isn't its own task: editing it changes the whole series. */
  function confirmEditSeries(task: Task) {
    const nextDate = fromYMD(task.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    Alert.alert(
      'Upcoming repeat',
      `This is a future repeat of “${task.title}”. Its next instance is on ${nextDate}. Changes apply to the whole series.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Edit series', onPress: () => openEdit(task) },
      ]
    );
  }

  async function handleSubmit(input: TaskInput) {
    // On failure the hook has already shown an alert; keep the form open.
    const ok = editing ? await updateTask(editing.id, input) : await addTask(input);
    if (ok) setFormOpen(false);
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const calendarDays = buildMonthGrid(displayYear, displayMonth);

  function visibleTasksOn(ymd: string): DatedTask[] {
    return tasksForDate(tasks, ymd).filter((d) => taskPassesFilters(d.task, d.projected, filters));
  }

  function dotsFor(ymd: string): string[] {
    const dots: string[] = [];
    if (visibleTasksOn(ymd).length > 0) dots.push(DOT_COLORS.task);
    if (filters.workouts && sessions.some((s) => s.performed_at === ymd)) dots.push(DOT_COLORS.workout);
    if (filters.health && healthStats.some((s) => s.recorded_at === ymd)) dots.push(DOT_COLORS.health);
    return dots;
  }

  const dayTasks    = visibleTasksOn(selectedDate);
  const daySessions = filters.workouts ? sessions.filter((s) => s.performed_at === selectedDate) : [];
  const dayHealth   = filters.health ? healthStats.filter((s) => s.recorded_at === selectedDate) : [];
  const dayHasAnything = dayTasks.length + daySessions.length + dayHealth.length > 0;
  const isOnToday =
    selectedDate === todayYMD && displayMonth === today.getMonth() && displayYear === today.getFullYear();

  // Calendar text colours (theme-aware)
  const dayTextColor = theme.text;
  const outsideMonthColor = isDark ? '#44403c' : '#d6d3d1';
  const todayBg = isDark ? '#134e4a' : '#ccfbf1';
  const todayText = isDark ? '#5eead4' : '#0d9488';

  // ── Render ──────────────────────────────────────────────────────────────────

  function renderTask({ task, projected }: DatedTask) {
    const time = formatTimeRange(task, is24Hour);
    const rec = task.recurrence;
    return (
      <TouchableOpacity
        key={`task-${task.id}-${projected ? selectedDate : 'real'}`}
        activeOpacity={0.7}
        onPress={() => (projected ? confirmEditSeries(task) : openEdit(task))}
        className="flex-row items-center bg-white dark:bg-stone-800 rounded-[10px] mb-2.5 overflow-hidden"
        style={{ borderLeftWidth: 4, borderLeftColor: priorityColor(task.priority), opacity: projected ? 0.55 : 1 }}
      >
        {projected ? (
          <View className="w-[46px] items-center">
            <Text className="text-base text-stone-400 dark:text-stone-500">🔄</Text>
          </View>
        ) : (
          <TouchableOpacity
            className="pl-3 pr-2.5 py-3"
            onPress={() => toggleDone(task.id)}
            hitSlop={6}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: task.done }}
          >
            <View className="w-[22px] h-[22px] rounded-[6px] border-2 border-teal-600 items-center justify-center">
              {task.done && <View className="w-[11px] h-[11px] rounded-[3px] bg-teal-600" />}
            </View>
          </TouchableOpacity>
        )}
        <View className="flex-1 py-2.5 pr-3">
          <Text
            numberOfLines={2}
            className={`text-[15px] font-semibold ${task.done ? 'line-through text-stone-400 dark:text-stone-500' : 'text-stone-800 dark:text-stone-100'}`}
          >
            {task.title}
          </Text>
          <View className="flex-row flex-wrap items-center mt-0.5" style={{ gap: 4 }}>
            {time ? <Text className="text-xs font-bold text-teal-700 dark:text-teal-400 mr-1">{time}</Text> : null}
            {rec !== 'none' && (
              <Text className="text-[11px] text-stone-500 dark:text-stone-400 mr-1">
                {projected ? 'Upcoming repeat' : `🔄 ${rec.charAt(0).toUpperCase() + rec.slice(1)}`}
              </Text>
            )}
            {task.tags.map((tag) => {
              const c = getTagColor(tag);
              return (
                <View
                  key={tag}
                  className="rounded-full px-1.5 py-[1px]"
                  style={{ backgroundColor: c.bg, borderWidth: 1, borderColor: c.border }}
                >
                  <Text className="text-[10px] font-semibold" style={{ color: c.text }}>
                    {tag === MUST_DO_TAG ? '★ Must Do' : tag}
                  </Text>
                </View>
              );
            })}
          </View>
          {task.notes ? (
            <Text className="text-[12px] text-stone-500 dark:text-stone-400 mt-1" numberOfLines={2}>
              {task.notes}
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  }

  function renderSession(item: WorkoutSession) {
    return (
      <View key={`session-${item.id}`} className="flex-row items-start bg-white dark:bg-stone-800 rounded-[10px] p-3 mb-2.5 shadow-sm">
        <View className="w-[68px] mr-2.5">
          <Text className="text-xs font-bold text-rose-600">Workout</Text>
        </View>
        <View className="flex-1">
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <Text className="text-[15px] font-semibold text-stone-800 dark:text-stone-100">
              {item.name || 'Workout'}
            </Text>
            <View className="bg-rose-50 border border-rose-100 rounded-full px-2 py-0.5">
              <Text className="text-[10px] font-semibold text-rose-700">💪 Done</Text>
            </View>
          </View>
          <Text className="text-[13px] text-stone-500 dark:text-stone-400 mt-[3px]">
            {item.exercise_count} exercise{item.exercise_count === 1 ? '' : 's'}
          </Text>
        </View>
      </View>
    );
  }

  function renderHealth(item: HealthStatRow) {
    const fields: { label: string; val: number | null; unit: string }[] = [
      { label: 'Weight', val: item.weight, unit: 'kg' },
      { label: 'Waist',  val: item.waist,  unit: 'cm' },
      { label: 'Chest',  val: item.chest,  unit: 'cm' },
      { label: 'Hips',   val: item.hips,   unit: 'cm' },
      { label: 'Arms',   val: item.arms,   unit: 'cm' },
      { label: 'Thighs', val: item.thighs, unit: 'cm' },
    ];
    const summary = fields.filter((f) => f.val !== null).map((f) => `${f.label} ${f.val}${f.unit}`).join(' · ');
    const b = item.weight && userHeight ? bmi(item.weight, userHeight) : null;

    return (
      <View key={`health-${item.id}`} className="flex-row items-start bg-white dark:bg-stone-800 rounded-[10px] p-3 mb-2.5 shadow-sm">
        <View className="w-[68px] mr-2.5">
          <Text className="text-xs font-bold text-emerald-600">Stats</Text>
        </View>
        <View className="flex-1">
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <Text className="text-[15px] font-semibold text-stone-800 dark:text-stone-100">Body Measurements</Text>
            {b !== null && (
              <View className="bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5">
                <Text className="text-[10px] font-semibold text-emerald-700">
                  BMI {b.toFixed(1)} · {bmiCategory(b)}
                </Text>
              </View>
            )}
          </View>
          {summary ? (
            <Text className="text-[12px] text-stone-500 dark:text-stone-400 mt-[3px]">{summary}</Text>
          ) : null}
          {item.notes ? (
            <Text className="text-[12px] text-stone-400 dark:text-stone-500 mt-0.5">{item.notes}</Text>
          ) : null}
        </View>
      </View>
    );
  }


  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.background }}>

      {/* ── Month navigation header ── */}
      <View className="flex-row items-center justify-between px-4 pt-4 pb-3">
        <TouchableOpacity className="p-2" onPress={prevMonth}>
          <Text className="text-2xl text-teal-700 dark:text-teal-400 font-semibold">‹</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={goToToday}>
          <Text className="text-base font-bold text-stone-800 dark:text-stone-100">
            {MONTH_NAMES[displayMonth]} {displayYear}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity className="p-2" onPress={nextMonth}>
          <Text className="text-2xl text-teal-700 dark:text-teal-400 font-semibold">›</Text>
        </TouchableOpacity>
      </View>

      {/* ── Day-of-week labels ── */}
      <View className="flex-row px-3 pb-1">
        {DAY_LABELS.map((label) => (
          <View key={label} className="flex-1 items-center">
            <Text className="text-[11px] font-semibold text-stone-400 dark:text-stone-500">{label}</Text>
          </View>
        ))}
      </View>

      {/* ── Calendar grid (6 rows × 7 cols) ── */}
      <View className="px-3 pb-2">
        {Array.from({ length: 6 }, (_, week) => (
          <View key={week} className="flex-row">
            {calendarDays.slice(week * 7, week * 7 + 7).map((day) => {
              const ymd = toYMD(day);
              const isCurrentMonth = day.getMonth() === displayMonth;
              const isToday = ymd === todayYMD;
              const isSelected = ymd === selectedDate;
              const dots = dotsFor(ymd);

              return (
                <TouchableOpacity
                  key={ymd}
                  className="flex-1 items-center py-1"
                  onPress={() => setSelectedDate(ymd)}
                >
                  <View
                    className="w-[34px] h-[34px] rounded-full items-center justify-center"
                    style={
                      isSelected
                        ? { backgroundColor: '#0d9488' }
                        : isToday
                        ? { backgroundColor: todayBg }
                        : undefined
                    }
                  >
                    <Text
                      className="text-[14px] font-semibold"
                      style={{
                        color: isSelected
                          ? '#ffffff'
                          : isToday
                          ? todayText
                          : isCurrentMonth
                          ? dayTextColor
                          : outsideMonthColor,
                      }}
                    >
                      {day.getDate()}
                    </Text>
                  </View>
                  {/* One dot per item type */}
                  <View className="h-[5px] flex-row items-center justify-center mt-[1px]" style={{ gap: 2 }}>
                    {dots.map((color) => (
                      <View
                        key={color}
                        className="w-[5px] h-[5px] rounded-full"
                        style={{ backgroundColor: color, opacity: isCurrentMonth ? 1 : 0.4 }}
                      />
                    ))}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      {/* ── Filter chips (toggles) ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, flexShrink: 0 }}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 10, gap: 6, alignItems: 'center' }}
      >
        {FILTERS.map((f) => {
          const on = filters[f.key];
          return (
            <TouchableOpacity
              key={f.key}
              className="flex-row items-center rounded-full px-3 border-[1.5px]"
              style={{
                height: 28,
                backgroundColor: on ? f.color : 'transparent',
                borderColor: f.color,
              }}
              onPress={() => toggleFilter(f.key)}
              accessibilityRole="switch"
              accessibilityState={{ checked: on }}
            >
              <Text className="text-[12px] font-semibold" style={{ color: on ? '#ffffff' : f.color }}>
                {on ? '✓ ' : ''}{f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Divider + selected date label ── */}
      <View className="h-px bg-stone-200 dark:bg-stone-700 mx-4 mb-3" />
      <View className="flex-row items-center justify-between px-4 mb-3">
        <Text className="text-sm font-semibold text-stone-600 dark:text-stone-300 flex-1" numberOfLines={1}>
          {fromYMD(selectedDate).toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
        </Text>
        <View className="flex-row" style={{ gap: 8 }}>
          <TouchableOpacity
            className="rounded-lg px-3 py-2 border-[1.5px] border-teal-600"
            disabled={isOnToday}
            style={isOnToday ? { opacity: 0.4 } : undefined}
            onPress={goToToday}
          >
            <Text className="text-teal-700 dark:text-teal-400 text-[13px] font-bold">Today</Text>
          </TouchableOpacity>
          <TouchableOpacity className="bg-teal-600 rounded-lg px-3.5 py-2" onPress={openAdd}>
            <Text className="text-white text-[13px] font-bold">+ Add</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Items for selected day ── */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
        {!dayHasAnything ? (
          <Text className="text-center text-stone-400 dark:text-stone-500 mt-6 text-sm">
            Nothing for this day.
          </Text>
        ) : (
          <>
            {dayTasks.map(renderTask)}
            {daySessions.map(renderSession)}
            {dayHealth.map(renderHealth)}
          </>
        )}
      </ScrollView>

      <TaskForm
        visible={formOpen}
        task={editing}
        defaultDate={selectedDate}
        is24Hour={is24Hour}
        onToggle24Hour={toggle24Hour}
        onSubmit={handleSubmit}
        onDelete={editing ? () => { deleteTask(editing.id); setFormOpen(false); } : undefined}
        onClose={() => setFormOpen(false)}
      />
    </SafeAreaView>
  );
}
