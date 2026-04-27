import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { cancelEventNotification, scheduleEventNotification } from '../utils/notifications';
import { loadData, saveData } from '../utils/storage';
import { supabase } from '../utils/supabase';

const STORAGE_KEY = 'planner_events';
const TASKS_KEY = 'tasks';
const HEIGHT_STORAGE_KEY = 'health_user_height_cm';

type PlannerEvent = {
  id: string;
  title: string;
  date: string;   // YYYY-MM-DD
  time: string;   // HH:MM (24h)
  notes: string;
  notificationId?: string | null;
};

type StoredTask = {
  id: string;
  title: string;
  done: boolean;
  priority: 'low' | 'medium' | 'high';
  dueDate: string;          // ISO
  dueTime?: string;         // HH:MM
  recurrence: 'none' | 'daily' | 'weekly' | 'monthly';
  tags?: string[];
};

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

type FilterKey = 'all' | 'events' | 'oneoff' | 'routine' | 'workouts' | 'health';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'events',   label: 'Events' },
  { key: 'oneoff',   label: 'One-off' },
  { key: 'routine',  label: 'Routine' },
  { key: 'workouts', label: 'Workouts' },
  { key: 'health',   label: 'Health' },
];

// ── Date helpers ─────────────────────────────────────────────────────────────

function toYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toHHMM(date: Date): string {
  return date.toTimeString().slice(0, 5);
}

function formatEventTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

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

const PRIORITY_COLORS: Record<StoredTask['priority'], string> = {
  low: '#84a98c',
  medium: '#d4a017',
  high: '#c44569',
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function PlannerScreen() {
  const today = new Date();
  const todayYMD = toYMD(today);

  const [displayYear, setDisplayYear] = useState(today.getFullYear());
  const [displayMonth, setDisplayMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(todayYMD);
  const [filter, setFilter] = useState<FilterKey>('all');

  const [events, setEvents] = useState<PlannerEvent[]>([]);
  const [tasks, setTasks] = useState<StoredTask[]>([]);
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [healthStats, setHealthStats] = useState<HealthStatRow[]>([]);
  const [userHeight, setUserHeight] = useState<number | null>(null);

  // Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [eventTime, setEventTime] = useState(new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);

  // ── Load on mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    loadData(STORAGE_KEY).then((stored) => {
      if (stored) setEvents(stored);
    });
  }, []);

  // Refresh tasks + remote data each time the planner is focused, so changes
  // made in other tabs (or in the Health screen) show up here.
  useFocusEffect(
    useCallback(() => {
      loadData(TASKS_KEY).then((stored) => {
        if (stored) setTasks(stored);
      });
      loadData(HEIGHT_STORAGE_KEY).then((stored) => {
        if (typeof stored === 'number' && stored > 0) setUserHeight(stored);
        else setUserHeight(null);
      });
      fetchSessions();
      fetchHealthStats();
    }, [])
  );

  async function fetchSessions() {
    const { data } = await supabase
      .from('workout_sessions')
      .select('id, name, performed_at, workout_session_exercises(count)')
      .order('performed_at', { ascending: false });
    if (data) {
      setSessions(
        data.map((s: any) => ({
          id: s.id,
          name: s.name,
          performed_at: s.performed_at,
          exercise_count: s.workout_session_exercises?.[0]?.count ?? 0,
        }))
      );
    }
  }

  async function fetchHealthStats() {
    const { data } = await supabase
      .from('health_stats')
      .select('id, recorded_at, weight, waist, chest, hips, arms, thighs, notes')
      .order('recorded_at', { ascending: false });
    if (data) setHealthStats(data as HealthStatRow[]);
  }

  async function persist(updated: PlannerEvent[]) {
    setEvents(updated);
    await saveData(STORAGE_KEY, updated);
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

  // ── Add event ───────────────────────────────────────────────────────────────

  function openModal() {
    setTitle('');
    setNotes('');
    setEventTime(new Date());
    setShowTimePicker(false);
    setModalVisible(true);
  }

  async function saveEvent() {
    if (!title.trim()) {
      Alert.alert('Missing title', 'Please enter an event title.');
      return;
    }
    const notificationId = await scheduleEventNotification(
      title.trim(),
      notes.trim(),
      selectedDate,
      toHHMM(eventTime)
    );
    const newEvent: PlannerEvent = {
      id: Date.now().toString(),
      title: title.trim(),
      date: selectedDate,
      time: toHHMM(eventTime),
      notes: notes.trim(),
      notificationId,
    };
    const updated = [...events, newEvent].sort((a, b) =>
      a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)
    );
    persist(updated);
    setModalVisible(false);
  }

  function confirmDelete(id: string) {
    Alert.alert('Delete event', 'Remove this event?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const event = events.find((e) => e.id === id);
          if (event?.notificationId) await cancelEventNotification(event.notificationId);
          persist(events.filter((e) => e.id !== id));
        },
      },
    ]);
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const calendarDays = buildMonthGrid(displayYear, displayMonth);

  function passesFilter(kind: 'event' | 'oneoff' | 'routine' | 'workout' | 'health') {
    if (filter === 'all') return true;
    if (filter === 'events')   return kind === 'event';
    if (filter === 'oneoff')   return kind === 'oneoff';
    if (filter === 'routine')  return kind === 'routine';
    if (filter === 'workouts') return kind === 'workout';
    if (filter === 'health')   return kind === 'health';
    return false;
  }

  function dateHasItems(ymd: string) {
    if (passesFilter('event')   && events.some((e) => e.date === ymd)) return true;
    if (passesFilter('oneoff')  && tasks.some((t) => t.recurrence === 'none' && t.dueDate.slice(0, 10) === ymd)) return true;
    if (passesFilter('routine') && tasks.some((t) => t.recurrence !== 'none' && t.dueDate.slice(0, 10) === ymd)) return true;
    if (passesFilter('workout') && sessions.some((s) => s.performed_at === ymd)) return true;
    if (passesFilter('health')  && healthStats.some((s) => s.recorded_at === ymd)) return true;
    return false;
  }

  const dayEvents     = passesFilter('event')   ? events.filter((e) => e.date === selectedDate) : [];
  const dayOneoff     = passesFilter('oneoff')  ? tasks.filter((t) => t.recurrence === 'none' && t.dueDate.slice(0, 10) === selectedDate) : [];
  const dayRoutine    = passesFilter('routine') ? tasks.filter((t) => t.recurrence !== 'none' && t.dueDate.slice(0, 10) === selectedDate) : [];
  const daySessions   = passesFilter('workout') ? sessions.filter((s) => s.performed_at === selectedDate) : [];
  const dayHealth     = passesFilter('health')  ? healthStats.filter((s) => s.recorded_at === selectedDate) : [];

  const dayHasAnything =
    dayEvents.length + dayOneoff.length + dayRoutine.length + daySessions.length + dayHealth.length > 0;

  // ── Render ──────────────────────────────────────────────────────────────────

  function renderEvent(item: PlannerEvent) {
    return (
      <View key={`event-${item.id}`} className="flex-row items-start bg-white rounded-[10px] p-3 mb-2.5 shadow-sm">
        <View className="w-[68px] mr-2.5">
          <Text className="text-xs font-bold text-teal-700">{formatEventTime(item.time)}</Text>
        </View>
        <View className="flex-1">
          <View className="flex-row items-center mb-0.5" style={{ gap: 6 }}>
            <Text className="text-[15px] font-semibold text-stone-800">{item.title}</Text>
            <View className="bg-teal-50 border border-teal-100 rounded-full px-2 py-0.5">
              <Text className="text-[10px] font-semibold text-teal-700">Event</Text>
            </View>
          </View>
          {item.notes ? (
            <Text className="text-[13px] text-stone-500 mt-[3px]">{item.notes}</Text>
          ) : null}
        </View>
        <TouchableOpacity className="p-1" onPress={() => confirmDelete(item.id)}>
          <Text className="text-sm text-stone-400">✕</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderTask(item: StoredTask) {
    const isRoutine = item.recurrence !== 'none';
    const badgeBg = isRoutine ? '#fef3c7' : '#e0f2fe';
    const badgeBorder = isRoutine ? '#fde68a' : '#bae6fd';
    const badgeText = isRoutine ? '#a16207' : '#0369a1';
    return (
      <View key={`task-${item.id}`} className="flex-row items-start bg-white rounded-[10px] p-3 mb-2.5 shadow-sm">
        <View className="w-[68px] mr-2.5">
          <Text className="text-xs font-bold text-stone-500">
            {item.dueTime ? formatEventTime(item.dueTime) : 'Task'}
          </Text>
        </View>
        <View className="flex-1">
          <View className="flex-row items-center flex-wrap" style={{ gap: 6 }}>
            <Text
              className={`text-[15px] font-semibold ${item.done ? 'line-through text-stone-400' : 'text-stone-800'}`}
            >
              {item.title}
            </Text>
            <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: badgeBg, borderWidth: 1, borderColor: badgeBorder }}>
              <Text className="text-[10px] font-semibold" style={{ color: badgeText }}>
                {isRoutine ? `🔄 ${item.recurrence.charAt(0).toUpperCase() + item.recurrence.slice(1)}` : 'One-off'}
              </Text>
            </View>
            <View className="rounded-[6px] px-[6px] py-[2px]" style={{
              backgroundColor: PRIORITY_COLORS[item.priority] + '22',
              borderWidth: 1,
              borderColor: PRIORITY_COLORS[item.priority],
            }}>
              <Text className="text-[10px] font-semibold" style={{ color: PRIORITY_COLORS[item.priority] }}>
                {item.priority.charAt(0).toUpperCase() + item.priority.slice(1)}
              </Text>
            </View>
          </View>
          {item.tags && item.tags.length > 0 ? (
            <Text className="text-[11px] text-stone-400 mt-0.5">{item.tags.join(' · ')}</Text>
          ) : null}
        </View>
      </View>
    );
  }

  function renderSession(item: WorkoutSession) {
    return (
      <View key={`session-${item.id}`} className="flex-row items-start bg-white rounded-[10px] p-3 mb-2.5 shadow-sm">
        <View className="w-[68px] mr-2.5">
          <Text className="text-xs font-bold text-rose-600">Workout</Text>
        </View>
        <View className="flex-1">
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <Text className="text-[15px] font-semibold text-stone-800">
              {item.name || 'Workout'}
            </Text>
            <View className="bg-rose-50 border border-rose-100 rounded-full px-2 py-0.5">
              <Text className="text-[10px] font-semibold text-rose-700">💪 Done</Text>
            </View>
          </View>
          <Text className="text-[13px] text-stone-500 mt-[3px]">
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
      <View key={`health-${item.id}`} className="flex-row items-start bg-white rounded-[10px] p-3 mb-2.5 shadow-sm">
        <View className="w-[68px] mr-2.5">
          <Text className="text-xs font-bold text-emerald-600">Stats</Text>
        </View>
        <View className="flex-1">
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <Text className="text-[15px] font-semibold text-stone-800">Body Measurements</Text>
            {b !== null && (
              <View className="bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5">
                <Text className="text-[10px] font-semibold text-emerald-700">
                  BMI {b.toFixed(1)} · {bmiCategory(b)}
                </Text>
              </View>
            )}
          </View>
          {summary ? (
            <Text className="text-[12px] text-stone-500 mt-[3px]">{summary}</Text>
          ) : null}
          {item.notes ? (
            <Text className="text-[12px] text-stone-400 mt-0.5">{item.notes}</Text>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: '#faf8f3' }}>

      {/* ── Month navigation header ── */}
      <View className="flex-row items-center justify-between px-4 pt-4 pb-3">
        <TouchableOpacity className="p-2" onPress={prevMonth}>
          <Text className="text-2xl text-teal-700 font-semibold">‹</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => {
          setDisplayYear(today.getFullYear());
          setDisplayMonth(today.getMonth());
          setSelectedDate(todayYMD);
        }}>
          <Text className="text-base font-bold text-stone-800">
            {MONTH_NAMES[displayMonth]} {displayYear}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity className="p-2" onPress={nextMonth}>
          <Text className="text-2xl text-teal-700 font-semibold">›</Text>
        </TouchableOpacity>
      </View>

      {/* ── Day-of-week labels ── */}
      <View className="flex-row px-3 pb-1">
        {DAY_LABELS.map((label) => (
          <View key={label} className="flex-1 items-center">
            <Text className="text-[11px] font-semibold text-stone-400">{label}</Text>
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
              const hasEvents = dateHasItems(ymd);

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
                        ? { backgroundColor: '#ccfbf1' }
                        : undefined
                    }
                  >
                    <Text
                      className="text-[14px] font-semibold"
                      style={{
                        color: isSelected
                          ? '#ffffff'
                          : isToday
                          ? '#0d9488'
                          : isCurrentMonth
                          ? '#1f2933'
                          : '#d6d3d1',
                      }}
                    >
                      {day.getDate()}
                    </Text>
                  </View>
                  {/* Event dot */}
                  <View className="h-[5px] items-center justify-center mt-[1px]">
                    {hasEvents && (
                      <View
                        className="w-[5px] h-[5px] rounded-full"
                        style={{ backgroundColor: isSelected ? '#5eead4' : '#0d9488' }}
                      />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      {/* ── Filter chips ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8, gap: 6 }}
      >
        {FILTERS.map((f) => {
          const selected = filter === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              className="rounded-full px-3 py-1.5 border"
              style={
                selected
                  ? { backgroundColor: '#0d9488', borderColor: '#0d9488' }
                  : { backgroundColor: '#ffffff', borderColor: '#e7e5e4' }
              }
              onPress={() => setFilter(f.key)}
            >
              <Text className={`text-[12px] font-semibold ${selected ? 'text-white' : 'text-stone-600'}`}>
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Divider + selected date label ── */}
      <View className="h-px bg-stone-200 mx-4 mb-3" />
      <View className="flex-row items-center justify-between px-4 mb-3">
        <Text className="text-sm font-semibold text-stone-600">
          {new Date(selectedDate + 'T00:00:00').toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
        </Text>
        <TouchableOpacity className="bg-teal-600 rounded-lg px-3.5 py-2" onPress={openModal}>
          <Text className="text-white text-[13px] font-bold">+ Add Event</Text>
        </TouchableOpacity>
      </View>

      {/* ── Items for selected day ── */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
        {!dayHasAnything ? (
          <Text className="text-center text-stone-400 mt-6 text-sm">
            Nothing for this day.
          </Text>
        ) : (
          <>
            {dayEvents.map(renderEvent)}
            {dayOneoff.map(renderTask)}
            {dayRoutine.map(renderTask)}
            {daySessions.map(renderSession)}
            {dayHealth.map(renderHealth)}
          </>
        )}
      </ScrollView>

      {/* ── Add event modal ── */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}
      >
        <Pressable
          className="flex-1 bg-black/40 justify-end"
          onPress={() => setModalVisible(false)}
        >
          <Pressable className="bg-white rounded-t-[20px] p-6 pb-10" onPress={() => {}}>
            <Text className="text-xl font-bold text-stone-800 mb-0.5">New Event</Text>
            <Text className="text-[13px] text-stone-500 mb-4">
              {new Date(selectedDate + 'T00:00:00').toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </Text>

            <TextInput
              className="border border-stone-200 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 mb-3"
              placeholder="Event title…"
              placeholderTextColor="#a8a29e"
              value={title}
              onChangeText={setTitle}
              returnKeyType="next"
              autoFocus
            />

            <TouchableOpacity
              className="border border-stone-200 rounded-lg px-3 py-2.5 mb-3"
              onPress={() => setShowTimePicker(true)}
            >
              <Text className="text-sm text-stone-600">
                Time: {formatEventTime(toHHMM(eventTime))}
              </Text>
            </TouchableOpacity>

            {showTimePicker && (
              <DateTimePicker
                value={eventTime}
                mode="time"
                is24Hour={false}
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(_, selected) => {
                  setShowTimePicker(Platform.OS === 'ios');
                  if (selected) setEventTime(selected);
                }}
              />
            )}

            <TextInput
              className="border border-stone-200 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 mb-3 h-20"
              placeholder="Notes (optional)…"
              placeholderTextColor="#a8a29e"
              value={notes}
              onChangeText={setNotes}
              multiline
              returnKeyType="done"
              textAlignVertical="top"
            />

            <View className="flex-row mt-1" style={{ gap: 12 }}>
              <TouchableOpacity
                className="flex-1 border-[1.5px] border-stone-200 rounded-lg py-3 items-center"
                onPress={() => setModalVisible(false)}
              >
                <Text className="text-[15px] font-semibold text-stone-500">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 bg-teal-600 rounded-lg py-3 items-center"
                onPress={saveEvent}
              >
                <Text className="text-[15px] font-bold text-white">Save</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
