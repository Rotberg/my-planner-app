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
  View
} from 'react-native';
import { cancelEventNotification, scheduleEventNotification } from '../utils/notifications';
import { loadData, saveData } from '../utils/storage';

const STORAGE_KEY = 'planner_events';

type PlannerEvent = {
  id: string;
  title: string;
  date: string;          // YYYY-MM-DD
  time: string;          // HH:MM (24h)
  notes: string;
  notificationId?: string | null;
};

// ── Date helpers ────────────────────────────────────────────────────────────

function toYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toHHMM(date: Date): string {
  return date.toTimeString().slice(0, 5);
}

function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function formatMonthRange(monday: Date): string {
  const sunday = addDays(monday, 6);
  const opts: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' };
  if (monday.getMonth() === sunday.getMonth()) {
    return monday.toLocaleDateString(undefined, opts);
  }
  return (
    monday.toLocaleDateString(undefined, { month: 'short' }) +
    ' / ' +
    sunday.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
  );
}

function formatEventTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ── Component ───────────────────────────────────────────────────────────────

export default function PlannerScreen() {
  const today = new Date();
  const [weekStart, setWeekStart] = useState<Date>(getMondayOf(today));
  const [selectedDate, setSelectedDate] = useState<string>(toYMD(today));
  const [events, setEvents] = useState<PlannerEvent[]>([]);

  // Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [eventTime, setEventTime] = useState<Date>(new Date());
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

  // ── Week navigation ──────────────────────────────────────────────────────

  function prevWeek() {
    setWeekStart((w) => addDays(w, -7));
  }

  function nextWeek() {
    setWeekStart((w) => addDays(w, 7));
  }

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // ── Add event ────────────────────────────────────────────────────────────

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
          if (event?.notificationId) {
            await cancelEventNotification(event.notificationId);
          }
          persist(events.filter((e) => e.id !== id));
        },
      },
    ]);
  }

  // ── Derived data ─────────────────────────────────────────────────────────

  const dayEvents = events.filter((e) => e.date === selectedDate);

  // ── Render ───────────────────────────────────────────────────────────────

  function renderEvent({ item }: { item: PlannerEvent }) {
    return (
      <View className="flex-row items-start bg-white rounded-[10px] p-3 mb-2.5 shadow-sm">
        <View className="w-[68px] mr-2.5">
          <Text className="text-xs font-bold text-indigo-500">{formatEventTime(item.time)}</Text>
        </View>
        <View className="flex-1">
          <Text className="text-[15px] font-semibold text-slate-800">{item.title}</Text>
          {item.notes ? (
            <Text className="text-[13px] text-slate-500 mt-[3px]">{item.notes}</Text>
          ) : null}
        </View>
        <TouchableOpacity className="p-1" onPress={() => confirmDelete(item.id)}>
          <Text className="text-sm text-slate-400">✕</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-50">
      {/* Week header */}
      <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
        <TouchableOpacity className="p-2" onPress={prevWeek}>
          <Text className="text-2xl text-indigo-500 font-semibold">‹</Text>
        </TouchableOpacity>
        <Text className="text-base font-bold text-slate-800">{formatMonthRange(weekStart)}</Text>
        <TouchableOpacity className="p-2" onPress={nextWeek}>
          <Text className="text-2xl text-indigo-500 font-semibold">›</Text>
        </TouchableOpacity>
      </View>

      {/* Day strip */}
      <View className="flex-row px-2 pb-3">
        {weekDays.map((day, i) => {
          const ymd = toYMD(day);
          const isSelected = ymd === selectedDate;
          const isToday = ymd === toYMD(today);
          const hasEvents = events.some((e) => e.date === ymd);
          return (
            <TouchableOpacity
              key={ymd}
              className={`flex-1 items-center py-2 rounded-xl ${isSelected ? 'bg-indigo-500' : ''}`}
              onPress={() => setSelectedDate(ymd)}
            >
              <Text
                className={`text-[11px] font-semibold mb-1 ${
                  isSelected ? 'text-indigo-100' : 'text-slate-500'
                }`}
              >
                {DAY_LABELS[i]}
              </Text>
              <Text
                className={`text-[15px] font-bold ${
                  isSelected
                    ? 'text-white'
                    : isToday
                    ? 'text-indigo-500'
                    : 'text-slate-800'
                }`}
              >
                {day.getDate()}
              </Text>
              {hasEvents && (
                <View
                  className={`w-[5px] h-[5px] rounded-full mt-1 ${
                    isSelected ? 'bg-indigo-100' : 'bg-indigo-500'
                  }`}
                />
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Selected date label */}
      <View className="flex-row items-center justify-between px-4 mb-3">
        <Text className="text-sm font-semibold text-slate-600">
          {new Date(selectedDate + 'T00:00:00').toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
        </Text>
        <TouchableOpacity className="bg-indigo-500 rounded-lg px-3.5 py-2" onPress={openModal}>
          <Text className="text-white text-[13px] font-bold">+ Add Event</Text>
        </TouchableOpacity>
      </View>

      {/* Events list */}
      <FlatList
        data={dayEvents}
        keyExtractor={(item) => item.id}
        renderItem={renderEvent}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        ListEmptyComponent={
          <Text className="text-center text-slate-400 mt-8 text-sm">No events for this day.</Text>
        }
      />

      {/* Add event modal */}
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
            <Text className="text-xl font-bold text-slate-800 mb-0.5">New Event</Text>
            <Text className="text-[13px] text-slate-500 mb-4">
              {new Date(selectedDate + 'T00:00:00').toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </Text>

            <TextInput
              className="border border-slate-200 rounded-lg px-3 py-2.5 text-[15px] text-slate-800 mb-3"
              placeholder="Event title…"
              placeholderTextColor="#94a3b8"
              value={title}
              onChangeText={setTitle}
              returnKeyType="next"
              autoFocus
            />

            <TouchableOpacity
              className="border border-slate-200 rounded-lg px-3 py-2.5 mb-3"
              onPress={() => setShowTimePicker(true)}
            >
              <Text className="text-sm text-slate-600">
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
              className="border border-slate-200 rounded-lg px-3 py-2.5 text-[15px] text-slate-800 mb-3 h-20 text-top"
              placeholder="Notes (optional)…"
              placeholderTextColor="#94a3b8"
              value={notes}
              onChangeText={setNotes}
              multiline
              returnKeyType="done"
              textAlignVertical="top"
            />

            <View className="flex-row gap-3 mt-1">
              <TouchableOpacity
                className="flex-1 border-[1.5px] border-slate-200 rounded-lg py-3 items-center"
                onPress={() => setModalVisible(false)}
              >
                <Text className="text-[15px] font-semibold text-slate-500">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 bg-indigo-500 rounded-lg py-3 items-center"
                onPress={saveEvent}
              >
                <Text className="text-[15px] font-bold text-white">Save</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
