import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { cancelEventNotification, scheduleEventNotification } from '../utils/notifications';
import { loadData, saveData } from '../utils/storage';

const STORAGE_KEY = 'planner_events';

type PlannerEvent = {
  id: string;
  title: string;
  date: string;   // YYYY-MM-DD
  time: string;   // HH:MM (24h)
  notes: string;
  notificationId?: string | null;
};

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

// ── Component ─────────────────────────────────────────────────────────────────

export default function PlannerScreen() {
  const today = new Date();
  const todayYMD = toYMD(today);

  const [displayYear, setDisplayYear] = useState(today.getFullYear());
  const [displayMonth, setDisplayMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(todayYMD);
  const [events, setEvents] = useState<PlannerEvent[]>([]);

  // Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [eventTime, setEventTime] = useState(new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);

  useEffect(() => {
    loadData(STORAGE_KEY).then((stored) => {
      if (stored) setEvents(stored);
    });
  }, []);

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
  const dayEvents = events.filter((e) => e.date === selectedDate);

  // ── Render ──────────────────────────────────────────────────────────────────

  function renderEvent({ item }: { item: PlannerEvent }) {
    return (
      <View className="flex-row items-start bg-white rounded-[10px] p-3 mb-2.5 shadow-sm">
        <View className="w-[68px] mr-2.5">
          <Text className="text-xs font-bold text-teal-700">{formatEventTime(item.time)}</Text>
        </View>
        <View className="flex-1">
          <Text className="text-[15px] font-semibold text-stone-800">{item.title}</Text>
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
              const hasEvents = events.some((e) => e.date === ymd);

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

      {/* ── Events for selected day ── */}
      <FlatList
        data={dayEvents}
        keyExtractor={(item) => item.id}
        renderItem={renderEvent}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        ListEmptyComponent={
          <Text className="text-center text-stone-400 mt-6 text-sm">No events for this day.</Text>
        }
      />

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
