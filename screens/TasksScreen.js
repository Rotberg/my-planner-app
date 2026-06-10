import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { loadData, saveData } from '../utils/storage';
import { useTheme } from '../utils/theme';

const STORAGE_KEY = 'tasks';
const TIME_FORMAT_KEY = 'tasks:timeFormat24h';

const PRIORITY_OPTIONS = [
  { label: 'Low', value: 'low', color: '#84a98c' },
  { label: 'Medium', value: 'medium', color: '#d4a017' },
  { label: 'High', value: 'high', color: '#c44569' },
];

const RECURRENCE_OPTIONS = [
  { label: 'Once', value: 'none' },
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
];

const PRESET_TAGS = ['Daily', 'Health', 'Work', 'Personal', 'Appointment', 'Exercise'];

const TAG_PALETTE = [
  { bg: '#eef0eb', border: '#cdd5c2', text: '#5a6a4a' },
  { bg: '#f5ebd4', border: '#e6d29a', text: '#8a6914' },
  { bg: '#f1d9d9', border: '#dcb0b0', text: '#8b3737' },
];

function getTagColor(tag) {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) & 0xffffffff;
  }
  return TAG_PALETTE[Math.abs(hash) % TAG_PALETTE.length];
}

function priorityColor(value) {
  return PRIORITY_OPTIONS.find((p) => p.value === value)?.color ?? '#6b7280';
}

function formatDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(hhmm, is24Hour = false) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const mm = String(m).padStart(2, '0');
  if (is24Hour) {
    return `${String(h).padStart(2, '0')}:${mm}`;
  }
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${mm} ${period}`;
}

function getNextDueDate(isoString, recurrence) {
  const d = new Date(isoString);
  if (recurrence === 'daily') d.setDate(d.getDate() + 1);
  else if (recurrence === 'weekly') d.setDate(d.getDate() + 7);
  else if (recurrence === 'monthly') d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

function toYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function TasksScreen() {
  const theme = useTheme();
  const [tasks, setTasks] = useState([]);

  // Form state — used for both "add" (when editingId === null) and "edit" modes
  const [editingId, setEditingId] = useState(null);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('medium');
  const [dueDate, setDueDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dueTime, setDueTime] = useState('');
  const [timePickerDate, setTimePickerDate] = useState(new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [endTime, setEndTime] = useState('');
  const [endTimePickerDate, setEndTimePickerDate] = useState(new Date());
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);
  const [recurrence, setRecurrence] = useState('none');
  const [selectedTags, setSelectedTags] = useState([]);
  const [customTagInput, setCustomTagInput] = useState('');
  const [is24Hour, setIs24Hour] = useState(false);

  // UI: collapse the add-task form behind a button + control showing past/future tasks
  const [formOpen, setFormOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    loadData(STORAGE_KEY).then((stored) => {
      if (stored) setTasks(stored);
    });
    loadData(TIME_FORMAT_KEY).then((stored) => {
      if (typeof stored === 'boolean') setIs24Hour(stored);
    });
  }, []);

  function toggleTimeFormat() {
    const next = !is24Hour;
    setIs24Hour(next);
    saveData(TIME_FORMAT_KEY, next);
  }

  async function persist(updated) {
    setTasks(updated);
    await saveData(STORAGE_KEY, updated);
  }

  // ─── Tag helpers ────────────────────────────────────────────────────────────
  function toggleTag(tag) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  function addCustomTag() {
    const tag = customTagInput.trim();
    if (!tag || selectedTags.includes(tag)) return;
    setSelectedTags((prev) => [...prev, tag]);
    setCustomTagInput('');
  }

  function removeTag(tag) {
    setSelectedTags((prev) => prev.filter((t) => t !== tag));
  }

  // ─── Form reset / submit / edit ────────────────────────────────────────────
  function resetForm() {
    setEditingId(null);
    setTitle('');
    setPriority('medium');
    setDueDate(new Date());
    setDueTime('');
    setEndTime('');
    setRecurrence('none');
    setSelectedTags([]);
    setCustomTagInput('');
    setFormOpen(false);
  }

  function startEditTask(task) {
    setEditingId(task.id);
    setTitle(task.title);
    setPriority(task.priority ?? 'medium');
    setDueDate(new Date(task.dueDate));
    setDueTime(task.dueTime ?? '');
    setEndTime(task.endTime ?? '');
    setRecurrence(task.recurrence ?? 'none');
    setSelectedTags([...(task.tags ?? [])]);
    setCustomTagInput('');
    setFormOpen(true);
  }

  function submitTask() {
    if (!title.trim()) {
      Alert.alert('Missing title', 'Please enter a task title.');
      return;
    }
    if (endTime && !dueTime) {
      Alert.alert('Missing start time', 'Set a start time before adding an end time.');
      return;
    }
    if (endTime && dueTime && endTime <= dueTime) {
      Alert.alert('Invalid end time', 'End time must be after the start time.');
      return;
    }

    if (editingId !== null) {
      persist(
        tasks.map((t) =>
          t.id === editingId
            ? {
                ...t,
                title: title.trim(),
                priority,
                dueDate: dueDate.toISOString(),
                dueTime,
                endTime,
                recurrence,
                tags: [...selectedTags],
              }
            : t
        )
      );
    } else {
      const newTask = {
        id: Date.now().toString(),
        title: title.trim(),
        done: false,
        priority,
        dueDate: dueDate.toISOString(),
        dueTime,
        endTime,
        recurrence,
        tags: [...selectedTags],
      };
      persist([newTask, ...tasks]);
    }
    resetForm();
  }

  // ─── Toggle done (handles recurrence) ──────────────────────────────────────
  function toggleDone(id) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const newDone = !task.done;

    if (newDone && task.recurrence && task.recurrence !== 'none') {
      const nextTask = {
        ...task,
        id: `${Date.now()}-${Math.random()}`,
        done: false,
        dueDate: getNextDueDate(task.dueDate, task.recurrence),
      };
      persist([nextTask, ...tasks.map((t) => (t.id === id ? { ...t, done: true } : t))]);
    } else {
      persist(tasks.map((t) => (t.id === id ? { ...t, done: newDone } : t)));
    }
  }

  function confirmDelete(id) {
    Alert.alert('Delete task', 'Are you sure you want to delete this task?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => persist(tasks.filter((t) => t.id !== id)),
      },
    ]);
  }

  // ─── Render task item ───────────────────────────────────────────────────────
  function renderTask({ item }) {
    const pColor = priorityColor(item.priority);
    const tags = item.tags ?? [];
    const rec = item.recurrence ?? 'none';

    return (
      <View className="bg-white dark:bg-stone-800 rounded-[10px] p-3 mb-2.5 shadow-sm">
        <View className="flex-row items-start">
          {/* Checkbox */}
          <TouchableOpacity
            className="w-[22px] h-[22px] rounded-[6px] border-2 border-teal-600 mr-3 items-center justify-center"
            style={{ marginTop: 2 }}
            onPress={() => toggleDone(item.id)}
          >
            {item.done && <View className="w-[11px] h-[11px] rounded-[3px] bg-teal-600" />}
          </TouchableOpacity>

          {/* Content */}
          <TouchableOpacity className="flex-1" onPress={() => startEditTask(item)} activeOpacity={0.6}>
            <Text
              className={`text-[15px] font-medium ${
                item.done ? 'line-through text-stone-400 dark:text-stone-500 dark:text-stone-500 dark:text-stone-400' : 'text-stone-800 dark:text-stone-100 dark:text-stone-100'
              }`}
            >
              {item.title}
            </Text>

            {/* Date / time / recurrence row */}
            <View className="flex-row flex-wrap items-center mt-0.5" style={{ gap: 6 }}>
              <Text className="text-xs text-stone-400 dark:text-stone-500 dark:text-stone-500 dark:text-stone-400">{formatDate(item.dueDate)}</Text>
              {item.dueTime ? (
                <Text className="text-xs text-stone-400 dark:text-stone-500 dark:text-stone-500 dark:text-stone-400">
                  · {formatTime(item.dueTime, is24Hour)}
                  {item.endTime ? ` – ${formatTime(item.endTime, is24Hour)}` : ''}
                </Text>
              ) : null}
              {rec !== 'none' && (
                <View className="flex-row items-center bg-teal-50 rounded-full px-2 py-0.5 border border-teal-100">
                  <Text className="text-[10px] text-teal-700 font-semibold">
                    🔄 {rec.charAt(0).toUpperCase() + rec.slice(1)}
                  </Text>
                </View>
              )}
            </View>

            {/* Tags */}
            {tags.length > 0 && (
              <View className="flex-row flex-wrap mt-1.5" style={{ gap: 4 }}>
                {tags.map((tag) => {
                  const c = getTagColor(tag);
                  return (
                    <View
                      key={tag}
                      className="rounded-full px-2 py-0.5"
                      style={{ backgroundColor: c.bg, borderWidth: 1, borderColor: c.border }}
                    >
                      <Text className="text-[10px] font-semibold" style={{ color: c.text }}>
                        {tag}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </TouchableOpacity>

          {/* Priority badge */}
          <View
            className="border rounded-[6px] px-[7px] py-[3px] mr-2 self-start"
            style={{ backgroundColor: pColor + '22', borderColor: pColor }}
          >
            <Text className="text-[11px] font-semibold" style={{ color: pColor }}>
              {item.priority.charAt(0).toUpperCase() + item.priority.slice(1)}
            </Text>
          </View>

          {/* Edit */}
          <TouchableOpacity className="p-1 self-start mr-1" onPress={() => startEditTask(item)}>
            <Text className="text-sm text-stone-400 dark:text-stone-500">✎</Text>
          </TouchableOpacity>

          {/* Delete */}
          <TouchableOpacity className="p-1 self-start" onPress={() => confirmDelete(item.id)}>
            <Text className="text-sm text-stone-400 dark:text-stone-500">✕</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const todayYMD = toYMD(new Date());
  const todayTasks = tasks.filter((t) => toYMD(new Date(t.dueDate)) === todayYMD);
  const otherTasks = tasks.filter((t) => toYMD(new Date(t.dueDate)) !== todayYMD);
  const displayedTasks = showAll ? tasks : todayTasks;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.background }}>
      {/* ── Add task button (collapsed state) ── */}
      {!formOpen && (
        <View className="flex-row items-center justify-between mx-4 mt-4 mb-2">
          <Text className="text-lg font-bold text-stone-800 dark:text-stone-100">
            {showAll ? `All Tasks (${tasks.length})` : `Today (${todayTasks.length})`}
          </Text>
          <TouchableOpacity
            className="bg-teal-600 rounded-full px-4 py-2"
            onPress={() => setFormOpen(true)}
          >
            <Text className="text-white text-sm font-bold">+ Add Task</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Show all / today toggle (collapsed state) ── */}
      {!formOpen && otherTasks.length > 0 && (
        <TouchableOpacity
          className="mx-4 mb-2"
          onPress={() => setShowAll((s) => !s)}
        >
          <Text className="text-xs font-semibold text-teal-700 dark:text-teal-400">
            {showAll ? '▲ Show today only' : `▼ Show all tasks (${otherTasks.length} other)`}
          </Text>
        </TouchableOpacity>
      )}

      {/* ── Input card ── */}
      {formOpen && (
      <View className="m-4 p-4 bg-white dark:bg-stone-800 dark:bg-stone-800 rounded-xl shadow">
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-lg font-bold text-stone-800 dark:text-stone-100 dark:text-stone-100">
            {editingId !== null ? 'Edit Task' : 'Add Task'}
          </Text>
          <TouchableOpacity onPress={resetForm}>
            <Text className="text-xs font-semibold text-stone-500 dark:text-stone-400 dark:text-stone-400 dark:text-stone-500">Cancel</Text>
          </TouchableOpacity>
        </View>

        {/* Title */}
        <TextInput
          className="border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 dark:text-stone-100 mb-3"
          placeholder="Task title…"
          placeholderTextColor={theme.placeholder}
          value={title}
          onChangeText={setTitle}
          returnKeyType="done"
        />

        {/* Priority */}
        <View className="flex-row mb-3" style={{ gap: 8 }}>
          {PRIORITY_OPTIONS.map((opt) => {
            const selected = priority === opt.value;
            return (
              <Pressable
                key={opt.value}
                className="flex-1 py-2 rounded-lg border-[1.5px] items-center"
                style={
                  selected
                    ? { backgroundColor: opt.color, borderColor: opt.color }
                    : { borderColor: opt.color }
                }
                onPress={() => setPriority(opt.value)}
              >
                <Text
                  className={`text-[13px] font-semibold ${selected ? 'text-white' : 'text-stone-700 dark:text-stone-200'}`}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Due date */}
        <TouchableOpacity
          className="border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 mb-3"
          onPress={() => setShowDatePicker(true)}
        >
          <Text className="text-sm text-stone-600 dark:text-stone-300">Due: {formatDate(dueDate.toISOString())}</Text>
        </TouchableOpacity>
        {showDatePicker && (
          <DateTimePicker
            value={dueDate}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            onChange={(_, selected) => {
              setShowDatePicker(Platform.OS === 'ios');
              if (selected) setDueDate(selected);
            }}
          />
        )}

        {/* Due time */}
        <View className="flex-row mb-3" style={{ gap: 8 }}>
          <TouchableOpacity
            className="flex-1 flex-row items-center justify-between border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5"
            onPress={() => {
              const seed = new Date();
              if (dueTime) {
                const [hh, mm] = dueTime.split(':').map(Number);
                seed.setHours(hh, mm, 0, 0);
              }
              setTimePickerDate(seed);
              setShowTimePicker(true);
            }}
          >
            <Text className="text-sm text-stone-600 dark:text-stone-300">
              {dueTime ? `Time: ${formatTime(dueTime, is24Hour)}` : 'Add time (optional)'}
            </Text>
            {dueTime ? (
              <TouchableOpacity
                onPress={(e) => {
                  e.stopPropagation();
                  setDueTime('');
                }}
              >
                <Text className="text-xs text-rose-600 font-semibold">Clear</Text>
              </TouchableOpacity>
            ) : null}
          </TouchableOpacity>
          <Pressable
            className="rounded-lg border-[1.5px] px-3 items-center justify-center"
            style={
              is24Hour
                ? { backgroundColor: '#0d9488', borderColor: '#0d9488' }
                : { borderColor: '#e7e5e4' }
            }
            onPress={toggleTimeFormat}
            accessibilityRole="switch"
            accessibilityState={{ checked: is24Hour }}
            accessibilityLabel="Toggle 24-hour time"
          >
            <Text
              className={`text-[12px] font-semibold ${is24Hour ? 'text-white' : 'text-stone-500 dark:text-stone-400'}`}
            >
              24h
            </Text>
          </Pressable>
        </View>
        {showTimePicker && (
          <DateTimePicker
            value={timePickerDate}
            mode="time"
            is24Hour={is24Hour}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(_, selected) => {
              setShowTimePicker(Platform.OS === 'ios');
              if (selected) {
                const h = String(selected.getHours()).padStart(2, '0');
                const m = String(selected.getMinutes()).padStart(2, '0');
                setDueTime(`${h}:${m}`);
              }
            }}
          />
        )}

        {/* End time (only enabled if a start time is set) */}
        {dueTime ? (
          <>
            <TouchableOpacity
              className="flex-row items-center justify-between border border-stone-200 dark:border-stone-700 dark:border-stone-700 rounded-lg px-3 py-2.5 mb-3"
              onPress={() => {
                const seed = new Date();
                if (endTime) {
                  const [hh, mm] = endTime.split(':').map(Number);
                  seed.setHours(hh, mm, 0, 0);
                } else {
                  const [hh, mm] = dueTime.split(':').map(Number);
                  seed.setHours(hh, mm + 30, 0, 0);
                }
                setEndTimePickerDate(seed);
                setShowEndTimePicker(true);
              }}
            >
              <Text className="text-sm text-stone-600 dark:text-stone-300 dark:text-stone-300">
                {endTime ? `End: ${formatTime(endTime, is24Hour)}` : 'Add end time (optional)'}
              </Text>
              {endTime ? (
                <TouchableOpacity
                  onPress={(e) => {
                    e.stopPropagation();
                    setEndTime('');
                  }}
                >
                  <Text className="text-xs text-rose-600 font-semibold">Clear</Text>
                </TouchableOpacity>
              ) : null}
            </TouchableOpacity>
            {showEndTimePicker && (
              <DateTimePicker
                value={endTimePickerDate}
                mode="time"
                is24Hour={is24Hour}
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(_, selected) => {
                  setShowEndTimePicker(Platform.OS === 'ios');
                  if (selected) {
                    const h = String(selected.getHours()).padStart(2, '0');
                    const m = String(selected.getMinutes()).padStart(2, '0');
                    setEndTime(`${h}:${m}`);
                  }
                }}
              />
            )}
          </>
        ) : null}

        {/* Recurrence */}
        <Text className="text-xs font-semibold text-stone-500 dark:text-stone-400 mb-1.5">Repeat</Text>
        <View className="flex-row mb-3" style={{ gap: 6 }}>
          {RECURRENCE_OPTIONS.map((opt) => {
            const selected = recurrence === opt.value;
            return (
              <Pressable
                key={opt.value}
                className="flex-1 py-2 rounded-lg border-[1.5px] items-center"
                style={
                  selected
                    ? { backgroundColor: '#0d9488', borderColor: '#0d9488' }
                    : { borderColor: '#e7e5e4' }
                }
                onPress={() => setRecurrence(opt.value)}
              >
                <Text
                  className={`text-[12px] font-semibold ${selected ? 'text-white' : 'text-stone-500 dark:text-stone-400'}`}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Tags */}
        <Text className="text-xs font-semibold text-stone-500 dark:text-stone-400 mb-1.5">Tags</Text>
        <View className="flex-row flex-wrap mb-2" style={{ gap: 6 }}>
          {PRESET_TAGS.map((tag) => {
            const isSelected = selectedTags.includes(tag);
            const c = getTagColor(tag);
            return (
              <TouchableOpacity
                key={tag}
                className="rounded-full px-3 py-1 border"
                style={
                  isSelected
                    ? { backgroundColor: c.bg, borderColor: c.border }
                    : { borderColor: '#e7e5e4' }
                }
                onPress={() => toggleTag(tag)}
              >
                <Text
                  className="text-xs font-medium"
                  style={isSelected ? { color: c.text } : { color: '#a8a29e' }}
                >
                  {tag}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View className="flex-row mb-2" style={{ gap: 8 }}>
          <TextInput
            className="flex-1 border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-800 dark:text-stone-100"
            placeholder="Custom tag…"
            placeholderTextColor={theme.placeholder}
            value={customTagInput}
            onChangeText={setCustomTagInput}
            returnKeyType="done"
            onSubmitEditing={addCustomTag}
          />
          <TouchableOpacity
            className="bg-stone-400 rounded-lg px-3 py-2 items-center justify-center"
            onPress={addCustomTag}
          >
            <Text className="text-white text-sm font-bold">Add</Text>
          </TouchableOpacity>
        </View>

        {/* Selected tags preview with remove */}
        {selectedTags.length > 0 && (
          <View className="flex-row flex-wrap mb-3" style={{ gap: 4 }}>
            {selectedTags.map((tag) => {
              const c = getTagColor(tag);
              return (
                <TouchableOpacity
                  key={tag}
                  className="flex-row items-center rounded-full px-2 py-0.5"
                  style={{ backgroundColor: c.bg, borderWidth: 1, borderColor: c.border }}
                  onPress={() => removeTag(tag)}
                >
                  <Text className="text-xs font-semibold mr-1" style={{ color: c.text }}>
                    {tag}
                  </Text>
                  <Text className="text-xs font-bold" style={{ color: c.text }}>×</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <TouchableOpacity
          className="bg-teal-600 rounded-lg py-3 items-center"
          onPress={submitTask}
        >
          <Text className="text-white text-[15px] font-bold">
            {editingId !== null ? 'Update Task' : 'Add Task'}
          </Text>
        </TouchableOpacity>
      </View>
      )}

      {/* ── Task list ── */}
      <FlatList
        data={displayedTasks}
        keyExtractor={(item) => item.id}
        renderItem={renderTask}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text className="text-center text-stone-400 dark:text-stone-500 mt-8 text-sm">
            {showAll ? 'No tasks yet. Add one above!' : 'Nothing for today. Tap + Add Task to create one.'}
          </Text>
        }
      />
    </SafeAreaView>
  );
}
