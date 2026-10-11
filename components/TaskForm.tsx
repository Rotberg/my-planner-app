import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  formatTime,
  fromYMD,
  getTagColor,
  MUST_DO_TAG,
  PRESET_TAGS,
  PRIORITY_OPTIONS,
  Priority,
  Recurrence,
  RECURRENCE_OPTIONS,
  Task,
  TaskInput,
  toYMD,
} from '../utils/tasks';
import { useTheme } from '../utils/theme';

type Props = {
  visible: boolean;
  /** Task being edited, or null to add a new one. */
  task: Task | null;
  /** Date used for new tasks (YYYY-MM-DD). */
  defaultDate: string;
  is24Hour: boolean;
  onToggle24Hour: () => void;
  onSubmit: (input: TaskInput) => void;
  onDelete?: () => void;
  onClose: () => void;
};

function hhmmFromDate(d: Date) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dateFromHHMM(hhmm: string | undefined, fallbackOffsetMin = 0) {
  const d = new Date();
  if (hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    d.setHours(h, m + fallbackOffsetMin, 0, 0);
  }
  return d;
}

/**
 * Add/edit form shared by the Tasks tab and the Planner.
 * Presented as a bottom sheet so it never pushes the task list off-screen.
 */
export default function TaskForm({
  visible,
  task,
  defaultDate,
  is24Hour,
  onToggle24Hour,
  onSubmit,
  onDelete,
  onClose,
}: Props) {
  const theme = useTheme();

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState<string | undefined>();
  const [endTime, setEndTime] = useState<string | undefined>();
  const [recurrence, setRecurrence] = useState<Recurrence>('none');
  const [tags, setTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState('');
  const [picker, setPicker] = useState<null | 'date' | 'start' | 'end'>(null);

  // Reset the form every time it opens.
  useEffect(() => {
    if (!visible) return;
    setTitle(task?.title ?? '');
    setNotes(task?.notes ?? '');
    setPriority(task?.priority ?? 'medium');
    setDate(task?.date ?? defaultDate);
    setStartTime(task?.startTime);
    setEndTime(task?.endTime);
    setRecurrence(task?.recurrence ?? 'none');
    setTags(task ? [...task.tags] : []);
    setCustomTag('');
    setPicker(null);
  }, [visible, task, defaultDate]);

  const mustDo = tags.includes(MUST_DO_TAG);

  function toggleTag(tag: string) {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  function addCustomTag() {
    const tag = customTag.trim();
    if (!tag) return;
    if (!tags.includes(tag)) setTags((prev) => [...prev, tag]);
    setCustomTag('');
  }

  function submit() {
    if (!title.trim()) {
      Alert.alert('Missing title', 'Please enter a title.');
      return;
    }
    if (endTime && startTime && endTime <= startTime) {
      Alert.alert('Invalid end time', 'End time must be after the start time.');
      return;
    }
    onSubmit({
      title: title.trim(),
      notes: notes.trim() || undefined,
      date,
      startTime,
      endTime: startTime ? endTime : undefined,
      priority,
      recurrence,
      tags,
    });
  }

  function confirmDelete() {
    // Deleting the live instance of a repeating task ends the series; deleting
    // a completed one only removes that entry.
    const isSeries = task && task.recurrence !== 'none' && !task.done;
    Alert.alert(
      isSeries ? 'Delete repeating task' : 'Delete task',
      isSeries
        ? 'This deletes the task and all of its future repeats. Completed past instances are kept.'
        : 'Are you sure you want to delete this task?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: onDelete },
      ]
    );
  }

  const inputClass =
    'border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 dark:text-stone-100';
  const fieldClass = 'border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5';
  const labelClass = 'text-xs font-semibold text-stone-500 dark:text-stone-400 mb-1.5';
  const extraTags = tags.filter((t) => t !== MUST_DO_TAG && !PRESET_TAGS.includes(t));

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <Pressable className="flex-1 justify-end" style={{ backgroundColor: theme.modalBackdrop }} onPress={onClose}>
          <Pressable
            className="bg-white dark:bg-stone-800 rounded-t-[20px]"
            style={{ maxHeight: '90%' }}
            onPress={() => {}}
          >
            <ScrollView
              contentContainerStyle={{ padding: 20, paddingBottom: 36 }}
              keyboardShouldPersistTaps="handled"
            >
              {/* Header */}
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-xl font-bold text-stone-800 dark:text-stone-100">
                  {task ? 'Edit Task' : 'New Task'}
                </Text>
                <TouchableOpacity onPress={onClose} hitSlop={10}>
                  <Text className="text-sm font-semibold text-stone-500 dark:text-stone-400">Cancel</Text>
                </TouchableOpacity>
              </View>

              {/* Title */}
              <TextInput
                className={`${inputClass} mb-3`}
                placeholder="What needs doing?"
                placeholderTextColor={theme.placeholder}
                value={title}
                onChangeText={setTitle}
                autoFocus={!task}
                returnKeyType="done"
              />

              {/* Must Do toggle */}
              <Pressable
                onPress={() => toggleTag(MUST_DO_TAG)}
                accessibilityRole="switch"
                accessibilityState={{ checked: mustDo }}
                accessibilityLabel="Must Do"
                className="flex-row items-center justify-between rounded-lg px-3 py-2 mb-3"
                style={{ backgroundColor: mustDo ? '#ccfbf1' : 'transparent', borderWidth: 1, borderColor: mustDo ? '#5eead4' : theme.border }}
              >
                <View className="flex-1 pr-3">
                  <Text className="text-sm font-semibold" style={{ color: mustDo ? '#0f766e' : theme.text }}>
                    Must Do
                  </Text>
                  <Text className="text-[11px]" style={{ color: mustDo ? '#0f766e' : theme.placeholder }}>
                    Counts towards today&apos;s progress
                  </Text>
                </View>
                <Switch
                  value={mustDo}
                  onValueChange={() => toggleTag(MUST_DO_TAG)}
                  trackColor={{ true: '#14b8a6', false: theme.border }}
                  thumbColor="#ffffff"
                />
              </Pressable>

              {/* Date */}
              <Text className={labelClass}>Date</Text>
              <TouchableOpacity className={`${fieldClass} mb-3`} onPress={() => setPicker('date')}>
                <Text className="text-sm text-stone-600 dark:text-stone-300">
                  {fromYMD(date).toLocaleDateString(undefined, {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </Text>
              </TouchableOpacity>
              {picker === 'date' && (
                <DateTimePicker
                  value={fromYMD(date)}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'inline' : 'default'}
                  onChange={(event, selected) => {
                    if (Platform.OS !== 'ios') setPicker(null);
                    // Android reports the original value on Cancel; only accept a real pick.
                    if (event.type !== 'set' || !selected) return;
                    setDate(toYMD(selected));
                  }}
                />
              )}

              {/* Times */}
              <Text className={labelClass}>Time</Text>
              <View className="flex-row mb-3" style={{ gap: 8 }}>
                <TouchableOpacity
                  className={`flex-1 flex-row items-center justify-between ${fieldClass}`}
                  onPress={() => setPicker('start')}
                >
                  <Text className="text-sm text-stone-600 dark:text-stone-300">
                    {startTime ? formatTime(startTime, is24Hour) : 'Start'}
                  </Text>
                  {startTime ? (
                    <TouchableOpacity
                      hitSlop={8}
                      onPress={() => {
                        setStartTime(undefined);
                        setEndTime(undefined);
                      }}
                    >
                      <Text className="text-xs text-rose-600 font-semibold">✕</Text>
                    </TouchableOpacity>
                  ) : null}
                </TouchableOpacity>
                <TouchableOpacity
                  className={`flex-1 flex-row items-center justify-between ${fieldClass}`}
                  style={!startTime ? { opacity: 0.4 } : undefined}
                  disabled={!startTime}
                  onPress={() => setPicker('end')}
                >
                  <Text className="text-sm text-stone-600 dark:text-stone-300">
                    {endTime ? formatTime(endTime, is24Hour) : 'End'}
                  </Text>
                  {endTime ? (
                    <TouchableOpacity hitSlop={8} onPress={() => setEndTime(undefined)}>
                      <Text className="text-xs text-rose-600 font-semibold">✕</Text>
                    </TouchableOpacity>
                  ) : null}
                </TouchableOpacity>
                <Pressable
                  className="rounded-lg border-[1.5px] px-3 items-center justify-center"
                  style={
                    is24Hour
                      ? { backgroundColor: '#0d9488', borderColor: '#0d9488' }
                      : { borderColor: theme.border }
                  }
                  onPress={onToggle24Hour}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: is24Hour }}
                  accessibilityLabel="Toggle 24-hour time"
                >
                  <Text className={`text-[12px] font-semibold ${is24Hour ? 'text-white' : 'text-stone-500 dark:text-stone-400'}`}>
                    24h
                  </Text>
                </Pressable>
              </View>
              {(picker === 'start' || picker === 'end') && (
                <DateTimePicker
                  value={
                    picker === 'start'
                      ? dateFromHHMM(startTime)
                      : endTime
                      ? dateFromHHMM(endTime)
                      : dateFromHHMM(startTime, 30)
                  }
                  mode="time"
                  is24Hour={is24Hour}
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(event, selected) => {
                    const which = picker;
                    if (Platform.OS !== 'ios') setPicker(null);
                    // Android reports the original value on Cancel; only accept a real pick.
                    if (event.type !== 'set' || !selected) return;
                    if (which === 'start') setStartTime(hhmmFromDate(selected));
                    else setEndTime(hhmmFromDate(selected));
                  }}
                />
              )}

              {/* Priority */}
              <Text className={labelClass}>Priority</Text>
              <View className="flex-row mb-3" style={{ gap: 8 }}>
                {PRIORITY_OPTIONS.map((opt) => {
                  const selected = priority === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      className="flex-1 py-2 rounded-lg border-[1.5px] items-center"
                      style={selected ? { backgroundColor: opt.color, borderColor: opt.color } : { borderColor: opt.color }}
                      onPress={() => setPriority(opt.value)}
                    >
                      <Text className={`text-[13px] font-semibold ${selected ? 'text-white' : 'text-stone-700 dark:text-stone-200'}`}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Recurrence */}
              <Text className={labelClass}>Repeat</Text>
              <View className="flex-row mb-3" style={{ gap: 6 }}>
                {RECURRENCE_OPTIONS.map((opt) => {
                  const selected = recurrence === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      className="flex-1 py-2 rounded-lg border-[1.5px] items-center"
                      style={selected ? { backgroundColor: '#0d9488', borderColor: '#0d9488' } : { borderColor: theme.border }}
                      onPress={() => setRecurrence(opt.value)}
                    >
                      <Text className={`text-[12px] font-semibold ${selected ? 'text-white' : 'text-stone-500 dark:text-stone-400'}`}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Tags */}
              <Text className={labelClass}>Tags</Text>
              <View className="flex-row flex-wrap mb-2" style={{ gap: 6 }}>
                {[...PRESET_TAGS, ...extraTags].map((tag) => {
                  const isSelected = tags.includes(tag);
                  const c = getTagColor(tag);
                  return (
                    <TouchableOpacity
                      key={tag}
                      className="rounded-full px-3 py-1 border"
                      style={isSelected ? { backgroundColor: c.bg, borderColor: c.border } : { borderColor: theme.border }}
                      onPress={() => toggleTag(tag)}
                    >
                      <Text className="text-xs font-medium" style={{ color: isSelected ? c.text : theme.placeholder }}>
                        {tag}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View className="flex-row mb-3" style={{ gap: 8 }}>
                <TextInput
                  className="flex-1 border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-800 dark:text-stone-100"
                  placeholder="Custom tag…"
                  placeholderTextColor={theme.placeholder}
                  value={customTag}
                  onChangeText={setCustomTag}
                  returnKeyType="done"
                  onSubmitEditing={addCustomTag}
                />
                <TouchableOpacity className="bg-stone-400 rounded-lg px-3 py-2 items-center justify-center" onPress={addCustomTag}>
                  <Text className="text-white text-sm font-bold">Add</Text>
                </TouchableOpacity>
              </View>

              {/* Notes */}
              <Text className={labelClass}>Notes</Text>
              <TextInput
                className={`${inputClass} mb-4 h-20`}
                placeholder="Optional…"
                placeholderTextColor={theme.placeholder}
                value={notes}
                onChangeText={setNotes}
                multiline
                textAlignVertical="top"
              />

              <TouchableOpacity className="bg-teal-600 rounded-lg py-3 items-center" onPress={submit}>
                <Text className="text-white text-[15px] font-bold">{task ? 'Save Changes' : 'Add Task'}</Text>
              </TouchableOpacity>

              {task && onDelete ? (
                <TouchableOpacity className="mt-3 py-2.5 items-center" onPress={confirmDelete}>
                  <Text className="text-rose-600 text-sm font-semibold">Delete Task</Text>
                </TouchableOpacity>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
