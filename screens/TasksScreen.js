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
import { loadData, saveData } from '../utils/storage';

const STORAGE_KEY = 'tasks';

const PRIORITY_OPTIONS = [
  { label: 'Low', value: 'low', color: '#22c55e' },
  { label: 'Medium', value: 'medium', color: '#f59e0b' },
  { label: 'High', value: 'high', color: '#ef4444' },
];

function priorityColor(value) {
  return PRIORITY_OPTIONS.find((p) => p.value === value)?.color ?? '#6b7280';
}

function formatDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TasksScreen() {
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('medium');
  const [dueDate, setDueDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    loadData(STORAGE_KEY).then((stored) => {
      if (stored) setTasks(stored);
    });
  }, []);

  async function persist(updated) {
    setTasks(updated);
    await saveData(STORAGE_KEY, updated);
  }

  function addTask() {
    if (!title.trim()) {
      Alert.alert('Missing title', 'Please enter a task title.');
      return;
    }
    const newTask = {
      id: Date.now().toString(),
      title: title.trim(),
      done: false,
      priority,
      dueDate: dueDate.toISOString(),
    };
    persist([newTask, ...tasks]);
    setTitle('');
    setPriority('medium');
    setDueDate(new Date());
  }

  function toggleDone(id) {
    persist(tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  }

  function confirmDelete(id) {
    Alert.alert('Delete task', 'Are you sure you want to delete this task?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => persist(tasks.filter((t) => t.id !== id)) },
    ]);
  }

  function onDateChange(event, selected) {
    setShowPicker(Platform.OS === 'ios');
    if (selected) setDueDate(selected);
  }

  function renderTask({ item }) {
    const pColor = priorityColor(item.priority);
    return (
      <View className="flex-row items-center bg-white rounded-[10px] p-3 mb-2.5 shadow-sm">
        <TouchableOpacity
          className="w-[22px] h-[22px] rounded-[6px] border-2 border-indigo-500 mr-3 items-center justify-center"
          onPress={() => toggleDone(item.id)}
        >
          {item.done && <View className="w-[11px] h-[11px] rounded-[3px] bg-indigo-500" />}
        </TouchableOpacity>

        <View className="flex-1">
          <Text
            className={`text-[15px] font-medium ${
              item.done ? 'line-through text-slate-400' : 'text-slate-800'
            }`}
          >
            {item.title}
          </Text>
          <Text className="text-xs text-slate-400 mt-0.5">{formatDate(item.dueDate)}</Text>
        </View>

        {/* Priority badge — color is dynamic, so we keep borderColor/bg as inline style */}
        <View
          className="border rounded-[6px] px-[7px] py-[3px] mr-2"
          style={{ backgroundColor: pColor + '22', borderColor: pColor }}
        >
          <Text className="text-[11px] font-semibold" style={{ color: pColor }}>
            {item.priority.charAt(0).toUpperCase() + item.priority.slice(1)}
          </Text>
        </View>

        <TouchableOpacity className="p-1" onPress={() => confirmDelete(item.id)}>
          <Text className="text-sm text-slate-400">✕</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-50">
      {/* Input card */}
      <View className="m-4 p-4 bg-white rounded-xl shadow">
        <Text className="text-lg font-bold text-slate-800 mb-3">Add Task</Text>

        <TextInput
          className="border border-slate-200 rounded-lg px-3 py-2.5 text-[15px] text-slate-800 mb-3"
          placeholder="Task title…"
          placeholderTextColor="#94a3b8"
          value={title}
          onChangeText={setTitle}
          returnKeyType="done"
        />

        {/* Priority selector — border/bg colors are dynamic */}
        <View className="flex-row gap-2 mb-3">
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
                  className={`text-[13px] font-semibold ${selected ? 'text-white' : 'text-gray-700'}`}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Due date */}
        <TouchableOpacity
          className="border border-slate-200 rounded-lg px-3 py-2.5 mb-3"
          onPress={() => setShowPicker(true)}
        >
          <Text className="text-sm text-slate-600">Due: {formatDate(dueDate.toISOString())}</Text>
        </TouchableOpacity>

        {showPicker && (
          <DateTimePicker
            value={dueDate}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            onChange={onDateChange}
          />
        )}

        <TouchableOpacity className="bg-indigo-500 rounded-lg py-3 items-center" onPress={addTask}>
          <Text className="text-white text-[15px] font-bold">Add Task</Text>
        </TouchableOpacity>
      </View>

      {/* Task list */}
      <FlatList
        data={tasks}
        keyExtractor={(item) => item.id}
        renderItem={renderTask}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        ListEmptyComponent={
          <Text className="text-center text-slate-400 mt-8 text-sm">
            No tasks yet. Add one above!
          </Text>
        }
      />
    </View>
  );
}
