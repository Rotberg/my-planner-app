import React, { useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import TaskForm from '../components/TaskForm';
import {
  compareTasks,
  dailyProgress,
  formatTimeRange,
  fromYMD,
  getTagColor,
  isMustDo,
  MUST_DO_TAG,
  priorityColor,
  Task,
  TaskInput,
  tasksForDate,
  todayYMD,
  useTasks,
  useTimeFormat,
} from '../utils/tasks';
import { useTheme } from '../utils/theme';

export default function TasksScreen() {
  const theme = useTheme();
  const { tasks, addTask, updateTask, deleteTask, toggleDone } = useTasks();
  const { is24Hour, toggle24Hour } = useTimeFormat();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [showOverdue, setShowOverdue] = useState(true);

  const today = todayYMD();
  // Only real instances: a projected repeat can't be ticked off yet.
  const todayTasks = tasksForDate(tasks, today)
    .filter((d) => !d.projected)
    .map((d) => d.task)
    .sort((a, b) => {
      // Must Do first within each done/undone group
      if (a.done === b.done && isMustDo(a) !== isMustDo(b)) return isMustDo(a) ? -1 : 1;
      return compareTasks(a, b);
    });
  const overdue = tasks.filter((t) => !t.done && t.date < today).sort((a, b) => a.date.localeCompare(b.date));
  const progress = dailyProgress(tasks, today);

  function openAdd() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(task: Task) {
    setEditing(task);
    setFormOpen(true);
  }

  async function handleSubmit(input: TaskInput) {
    // Keep the form open if the save failed (the hook has already alerted).
    const ok = editing ? await updateTask(editing.id, input) : await addTask(input);
    if (ok) setFormOpen(false);
  }

  function confirmDelete(task: Task) {
    Alert.alert('Delete task', `Delete “${task.title}”?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteTask(task.id) },
    ]);
  }

  function renderTask(item: Task, showDate = false) {
    const tags = item.tags;
    const time = formatTimeRange(item, is24Hour);
    const meta = [
      showDate ? fromYMD(item.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null,
      time || null,
      item.recurrence !== 'none' ? `🔄 ${item.recurrence.charAt(0).toUpperCase() + item.recurrence.slice(1)}` : null,
    ].filter(Boolean);

    return (
      <TouchableOpacity
        key={item.id}
        activeOpacity={0.7}
        onPress={() => openEdit(item)}
        onLongPress={() => confirmDelete(item)}
        className="flex-row items-center bg-white dark:bg-stone-800 rounded-[10px] mb-2 overflow-hidden"
        style={{ borderLeftWidth: 4, borderLeftColor: priorityColor(item.priority) }}
      >
        <TouchableOpacity
          className="pl-3 pr-2.5 py-3"
          onPress={() => toggleDone(item.id)}
          hitSlop={6}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: item.done }}
        >
          <View className="w-[22px] h-[22px] rounded-[6px] border-2 border-teal-600 items-center justify-center">
            {item.done && <View className="w-[11px] h-[11px] rounded-[3px] bg-teal-600" />}
          </View>
        </TouchableOpacity>

        <View className="flex-1 py-2.5 pr-3">
          <Text
            numberOfLines={2}
            className={`text-[15px] font-medium ${item.done ? 'line-through text-stone-400 dark:text-stone-500' : 'text-stone-800 dark:text-stone-100'}`}
          >
            {item.title}
          </Text>
          {(meta.length > 0 || tags.length > 0) && (
            <View className="flex-row flex-wrap items-center mt-1" style={{ gap: 4 }}>
              {meta.length > 0 && (
                <Text className="text-xs text-stone-500 dark:text-stone-400 mr-1">{meta.join(' · ')}</Text>
              )}
              {tags.map((tag) => {
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
          )}
        </View>
      </TouchableOpacity>
    );
  }

  const complete = progress.total > 0 && progress.done === progress.total;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.background }}>
      {/* ── Header ── */}
      <View className="flex-row items-center justify-between px-4 pt-4 pb-3">
        <View>
          <Text className="text-2xl font-bold text-stone-800 dark:text-stone-100">Today</Text>
          <Text className="text-xs text-stone-500 dark:text-stone-400">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </Text>
        </View>
        <TouchableOpacity className="bg-teal-600 rounded-full px-4 py-2" onPress={openAdd}>
          <Text className="text-white text-sm font-bold">+ Add</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
        {/* ── Daily progress ── */}
        <View className="bg-white dark:bg-stone-800 rounded-xl p-4 mb-4">
          {progress.total === 0 ? (
            <>
              <Text className="text-sm font-semibold text-stone-700 dark:text-stone-200">Today&apos;s progress</Text>
              <Text className="text-xs text-stone-500 dark:text-stone-400 mt-1">
                Mark tasks as Must Do to track your daily progress.
              </Text>
            </>
          ) : (
            <>
              <View className="flex-row items-baseline justify-between mb-2">
                <Text className="text-sm font-semibold text-stone-700 dark:text-stone-200">
                  {complete ? '✓ All Must Do tasks done' : "Today's progress"}
                </Text>
                <Text className="text-sm font-bold" style={{ color: complete ? '#16a34a' : '#0d9488' }}>
                  {progress.done} / {progress.total} · {progress.percent}%
                </Text>
              </View>
              <View className="h-2.5 rounded-full bg-stone-100 dark:bg-stone-700 overflow-hidden">
                <View
                  className="h-full rounded-full"
                  style={{ width: `${progress.percent}%`, backgroundColor: complete ? '#16a34a' : '#14b8a6' }}
                />
              </View>
            </>
          )}
        </View>

        {/* ── Overdue ── */}
        {overdue.length > 0 && (
          <View className="mb-3">
            <TouchableOpacity className="flex-row items-center mb-2" onPress={() => setShowOverdue((s) => !s)}>
              <Text className="text-xs font-bold uppercase tracking-wide text-rose-600 mr-1">
                Overdue ({overdue.length})
              </Text>
              <Text className="text-xs text-rose-600">{showOverdue ? '▲' : '▼'}</Text>
            </TouchableOpacity>
            {showOverdue && overdue.map((t) => renderTask(t, true))}
          </View>
        )}

        {/* ── Today ── */}
        <Text className="text-xs font-bold uppercase tracking-wide text-stone-500 dark:text-stone-400 mb-2">
          Tasks ({todayTasks.length})
        </Text>
        {todayTasks.length === 0 ? (
          <Text className="text-center text-stone-400 dark:text-stone-500 mt-6 text-sm">
            Nothing for today. Tap + Add to create a task.
          </Text>
        ) : (
          todayTasks.map((t) => renderTask(t))
        )}
        {todayTasks.length > 0 && (
          <Text className="text-center text-[11px] text-stone-400 dark:text-stone-500 mt-2">
            Tap to edit · long-press to delete
          </Text>
        )}
      </ScrollView>

      <TaskForm
        visible={formOpen}
        task={editing}
        defaultDate={today}
        is24Hour={is24Hour}
        onToggle24Hour={toggle24Hour}
        onSubmit={handleSubmit}
        onDelete={
          editing
            ? async () => {
                // On failure the hook has shown an alert; keep the form open to retry.
                if (await deleteTask(editing.id)) setFormOpen(false);
              }
            : undefined
        }
        onClose={() => setFormOpen(false)}
      />
    </SafeAreaView>
  );
}
