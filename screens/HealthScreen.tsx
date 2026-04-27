import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useEffect, useState } from 'react';
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
import { z } from 'zod';
import { loadData, saveData } from '../utils/storage';
import { supabase } from '../utils/supabase';

const STORAGE_KEY = 'health_workout_current';
const HEIGHT_STORAGE_KEY = 'health_user_height_cm';

// ─── Stats ──────────────────────────────────────────────────────────────────
const MEASUREMENT_FIELDS = [
  { key: 'weight', label: 'Weight', unit: 'kg' },
  { key: 'waist',  label: 'Waist',  unit: 'cm' },
  { key: 'chest',  label: 'Chest',  unit: 'cm' },
  { key: 'hips',   label: 'Hips',   unit: 'cm' },
  { key: 'arms',   label: 'Arms',   unit: 'cm' },
  { key: 'thighs', label: 'Thighs', unit: 'cm' },
] as const;
type MeasurementKey = (typeof MEASUREMENT_FIELDS)[number]['key'];

type HealthStat = {
  id: string;
  recorded_at: string; // YYYY-MM-DD
  weight: number | null;
  waist: number | null;
  chest: number | null;
  hips: number | null;
  arms: number | null;
  thighs: number | null;
  notes: string | null;
};

const numericField = z
  .string()
  .trim()
  .refine((v) => v === '' || /^\d+(\.\d+)?$/.test(v), {
    message: 'Must be a number (e.g. 72 or 72.5).',
  })
  .refine((v) => v === '' || Number(v) > 0, {
    message: 'Must be greater than zero.',
  });

const StatsFormSchema = z
  .object({
    weight: numericField,
    waist: numericField,
    chest: numericField,
    hips: numericField,
    arms: numericField,
    thighs: numericField,
  })
  .refine(
    (v) => Object.values(v).some((s) => s !== ''),
    { message: 'Enter at least one measurement.' }
  );

const HeightSchema = z
  .string()
  .trim()
  .refine((v) => /^\d+(\.\d+)?$/.test(v), { message: 'Must be a number (e.g. 175 or 175.5).' })
  .refine((v) => Number(v) > 0 && Number(v) < 300, { message: 'Enter height in cm.' });

// BMI = weight (kg) / height (m)^2
function calcBMI(weightKg: number, heightCm: number) {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

function bmiCategory(b: number) {
  if (b < 18.5) return 'Underweight';
  if (b < 25) return 'Normal';
  if (b < 30) return 'Overweight';
  return 'Obese';
}

// ─── Workout ────────────────────────────────────────────────────────────────
type Exercise = {
  id: string;
  name: string;
  sets: string;
  reps: string;
  weight: string; // free-form, e.g. "20kg" or "bodyweight"
  notes: string;
};

type SavedRoutine = {
  id: string;
  name: string;
  created_at: string;
  exercises?: SavedRoutineExercise[];
};

type SavedRoutineExercise = {
  id: string;
  name: string;
  sets: string | null;
  reps: string | null;
  weight: string | null;
  notes: string | null;
  position: number;
};

type CatalogExercise = { id: string; name: string };

const ExerciseFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Please enter an exercise name.')
    .max(80, 'Name is too long (max 80 characters).'),
  sets: z.string().trim().max(20, 'Sets value is too long.'),
  reps: z.string().trim().max(20, 'Reps value is too long.'),
  weight: z.string().trim().max(40, 'Weight value is too long.'),
  notes: z.string().trim().max(200, 'Notes are too long.'),
});

const RoutineNameSchema = z
  .string()
  .trim()
  .min(1, 'Please enter a routine name.')
  .max(80, 'Name is too long (max 80 characters).');

const CatalogNameSchema = RoutineNameSchema;

function formatShortDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function HealthScreen() {
  const [view, setView] = useState<'stats' | 'workout' | 'saved'>('stats');

  // ─── Stats state ──────────────────────────────────────────────────────────
  const [statForm, setStatForm] = useState<Record<MeasurementKey, string>>({
    weight: '', waist: '', chest: '', hips: '', arms: '', thighs: '',
  });
  const [statNotes, setStatNotes] = useState('');
  const [statDate, setStatDate] = useState<Date>(new Date());
  const [showStatDatePicker, setShowStatDatePicker] = useState(false);
  const [statHistory, setStatHistory] = useState<HealthStat[]>([]);
  const [expandedStatId, setExpandedStatId] = useState<string | null>(null);

  // User-level height (for BMI). Stored once in AsyncStorage rather than
  // logged with every entry — height rarely changes.
  const [userHeight, setUserHeight] = useState<number | null>(null);
  const [heightInput, setHeightInput] = useState('');
  const [editingHeight, setEditingHeight] = useState(false);

  // ─── Workout state ────────────────────────────────────────────────────────
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [exName, setExName] = useState('');
  const [exSets, setExSets] = useState('');
  const [exReps, setExReps] = useState('');
  const [exWeight, setExWeight] = useState('');
  const [exNotes, setExNotes] = useState('');

  const [exerciseCatalog, setExerciseCatalog] = useState<CatalogExercise[]>([]);
  const [showCatalog, setShowCatalog] = useState(false);
  const [newCatalogName, setNewCatalogName] = useState('');

  // Edit-exercise modal
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSets, setEditSets] = useState('');
  const [editReps, setEditReps] = useState('');
  const [editWeight, setEditWeight] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // Save-routine modal
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [routineName, setRoutineName] = useState('');

  // Save-workout (completed session) modal
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [sessionDate, setSessionDate] = useState<Date>(new Date());
  const [showSessionDatePicker, setShowSessionDatePicker] = useState(false);

  // ─── Saved routines state ────────────────────────────────────────────────
  const [savedRoutines, setSavedRoutines] = useState<SavedRoutine[]>([]);
  const [expandedRoutineId, setExpandedRoutineId] = useState<string | null>(null);

  // ─── Load on mount ───────────────────────────────────────────────────────
  useEffect(() => {
    loadData(STORAGE_KEY).then((stored) => {
      if (stored) setExercises(stored);
    });
    loadData(HEIGHT_STORAGE_KEY).then((stored) => {
      if (typeof stored === 'number' && stored > 0) setUserHeight(stored);
    });
    fetchExerciseCatalog();
  }, []);

  async function saveHeight() {
    const parsed = HeightSchema.safeParse(heightInput);
    if (!parsed.success) {
      Alert.alert('Invalid height', parsed.error.issues[0]?.message ?? 'Please check the value.');
      return;
    }
    const value = Number(parsed.data);
    setUserHeight(value);
    setEditingHeight(false);
    setHeightInput('');
    await saveData(HEIGHT_STORAGE_KEY, value);
  }

  useEffect(() => {
    if (view === 'stats') fetchStatHistory();
    if (view === 'saved') fetchSavedRoutines();
  }, [view]);

  // ─── Supabase: stats ─────────────────────────────────────────────────────
  async function fetchStatHistory() {
    const { data } = await supabase
      .from('health_stats')
      .select('id, recorded_at, weight, waist, chest, hips, arms, thighs, notes')
      .order('recorded_at', { ascending: false });
    if (data) setStatHistory(data as HealthStat[]);
  }

  async function saveStatEntry() {
    const parsed = StatsFormSchema.safeParse(statForm);
    if (!parsed.success) {
      Alert.alert('Invalid entry', parsed.error.issues[0]?.message ?? 'Please check the form.');
      return;
    }
    const toNum = (s: string) => (s === '' ? null : Number(s));
    const payload = {
      recorded_at: statDate.toISOString().split('T')[0],
      weight: toNum(parsed.data.weight),
      waist:  toNum(parsed.data.waist),
      chest:  toNum(parsed.data.chest),
      hips:   toNum(parsed.data.hips),
      arms:   toNum(parsed.data.arms),
      thighs: toNum(parsed.data.thighs),
      notes: statNotes.trim() || null,
    };
    const { error } = await supabase.from('health_stats').insert(payload);
    if (error) {
      Alert.alert('Error', 'Could not save entry. Check your connection.');
      return;
    }
    setStatForm({ weight: '', waist: '', chest: '', hips: '', arms: '', thighs: '' });
    setStatNotes('');
    setStatDate(new Date());
    fetchStatHistory();
    Alert.alert('Saved!', 'Entry recorded.');
  }

  function confirmDeleteStat(id: string) {
    Alert.alert('Delete entry', 'Permanently delete this entry?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('health_stats').delete().eq('id', id);
          setStatHistory((prev) => prev.filter((s) => s.id !== id));
        },
      },
    ]);
  }

  // ─── Supabase: routines & catalog ────────────────────────────────────────
  async function fetchExerciseCatalog() {
    const { data } = await supabase.from('exercise_catalog').select('id, name').order('name');
    if (data) setExerciseCatalog(data);
  }

  async function fetchSavedRoutines() {
    const { data } = await supabase
      .from('workout_routines')
      .select('id, name, created_at')
      .order('created_at', { ascending: false });
    if (data) setSavedRoutines(data);
  }

  async function fetchRoutineExercises(routineId: string) {
    const { data } = await supabase
      .from('workout_routine_exercises')
      .select('id, name, sets, reps, weight, notes, position')
      .eq('routine_id', routineId)
      .order('position', { ascending: true });
    if (data) {
      setSavedRoutines((prev) =>
        prev.map((r) => (r.id === routineId ? { ...r, exercises: data } : r))
      );
    }
  }

  // ─── Workout helpers (AsyncStorage) ──────────────────────────────────────
  async function persistWorkout(updated: Exercise[]) {
    setExercises(updated);
    await saveData(STORAGE_KEY, updated);
  }

  function addExercise() {
    const parsed = ExerciseFormSchema.safeParse({
      name: exName,
      sets: exSets,
      reps: exReps,
      weight: exWeight,
      notes: exNotes,
    });
    if (!parsed.success) {
      Alert.alert('Invalid exercise', parsed.error.issues[0]?.message ?? 'Please check the form.');
      return;
    }
    const newEx: Exercise = {
      id: `${Date.now()}-${Math.random()}`,
      name: parsed.data.name,
      sets: parsed.data.sets,
      reps: parsed.data.reps,
      weight: parsed.data.weight,
      notes: parsed.data.notes,
    };
    persistWorkout([...exercises, newEx]);
    setExName('');
    setExSets('');
    setExReps('');
    setExWeight('');
    setExNotes('');
  }

  function addFromCatalog(name: string) {
    if (exercises.some((e) => e.name.toLowerCase() === name.toLowerCase())) return;
    persistWorkout([
      ...exercises,
      {
        id: `${Date.now()}-${Math.random()}`,
        name,
        sets: '',
        reps: '',
        weight: '',
        notes: '',
      },
    ]);
  }

  function confirmDeleteExercise(id: string) {
    Alert.alert('Remove exercise', 'Remove this exercise from the workout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => persistWorkout(exercises.filter((e) => e.id !== id)),
      },
    ]);
  }

  function openEditExercise(ex: Exercise) {
    setEditingId(ex.id);
    setEditName(ex.name);
    setEditSets(ex.sets);
    setEditReps(ex.reps);
    setEditWeight(ex.weight);
    setEditNotes(ex.notes);
  }

  function saveEditExercise() {
    if (!editingId) return;
    const parsed = ExerciseFormSchema.safeParse({
      name: editName,
      sets: editSets,
      reps: editReps,
      weight: editWeight,
      notes: editNotes,
    });
    if (!parsed.success) {
      Alert.alert('Invalid exercise', parsed.error.issues[0]?.message ?? 'Please check the form.');
      return;
    }
    persistWorkout(
      exercises.map((e) =>
        e.id === editingId
          ? {
              ...e,
              name: parsed.data.name,
              sets: parsed.data.sets,
              reps: parsed.data.reps,
              weight: parsed.data.weight,
              notes: parsed.data.notes,
            }
          : e
      )
    );
    setEditingId(null);
  }

  function clearWorkout() {
    if (exercises.length === 0) return;
    Alert.alert('Clear workout', 'Remove all exercises from the current workout?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => persistWorkout([]) },
    ]);
  }

  // ─── Save current workout as a routine ───────────────────────────────────
  async function saveCurrentRoutine() {
    const parsed = RoutineNameSchema.safeParse(routineName);
    if (!parsed.success) {
      Alert.alert('Invalid name', parsed.error.issues[0]?.message ?? 'Please check the name.');
      return;
    }
    if (exercises.length === 0) {
      Alert.alert('Empty workout', 'Add some exercises before saving.');
      return;
    }

    const { data: routine, error } = await supabase
      .from('workout_routines')
      .insert({ name: parsed.data })
      .select()
      .single();

    if (error || !routine) {
      Alert.alert('Error', 'Could not save routine. Check your connection.');
      return;
    }

    await supabase.from('workout_routine_exercises').insert(
      exercises.map((e, idx) => ({
        routine_id: routine.id,
        name: e.name,
        sets: e.sets || null,
        reps: e.reps || null,
        weight: e.weight || null,
        notes: e.notes || null,
        position: idx,
      }))
    );

    setShowSaveModal(false);
    setRoutineName('');
    Alert.alert('Saved!', `"${parsed.data}" has been saved.`);
  }

  // ─── Save current workout as a completed session (history) ───────────────
  async function saveCurrentSession() {
    if (exercises.length === 0) {
      Alert.alert('Empty workout', 'Add some exercises before saving.');
      return;
    }

    const name = sessionName.trim() || null;

    const { data: session, error } = await supabase
      .from('workout_sessions')
      .insert({
        name,
        performed_at: sessionDate.toISOString().split('T')[0],
      })
      .select()
      .single();

    if (error || !session) {
      Alert.alert('Error', 'Could not save workout. Check your connection.');
      return;
    }

    await supabase.from('workout_session_exercises').insert(
      exercises.map((e, idx) => ({
        session_id: session.id,
        name: e.name,
        sets: e.sets || null,
        reps: e.reps || null,
        weight: e.weight || null,
        notes: e.notes || null,
        position: idx,
      }))
    );

    setShowSessionModal(false);
    setSessionName('');
    setSessionDate(new Date());
    Alert.alert(
      'Workout saved',
      'View it in the planner on the date you logged it.',
      [
        {
          text: 'OK',
          onPress: () => persistWorkout([]),
        },
      ]
    );
  }

  // ─── Catalog management ──────────────────────────────────────────────────
  async function addToCatalog() {
    const parsed = CatalogNameSchema.safeParse(newCatalogName);
    if (!parsed.success) {
      Alert.alert('Invalid name', parsed.error.issues[0]?.message ?? 'Please check the name.');
      return;
    }
    await supabase
      .from('exercise_catalog')
      .upsert({ name: parsed.data }, { onConflict: 'name' });
    setNewCatalogName('');
    fetchExerciseCatalog();
  }

  function confirmDeleteCatalog(item: CatalogExercise) {
    Alert.alert('Remove from catalog?', item.name, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('exercise_catalog').delete().eq('id', item.id);
          fetchExerciseCatalog();
        },
      },
    ]);
  }

  // ─── Saved routines management ───────────────────────────────────────────
  function confirmDeleteRoutine(id: string) {
    Alert.alert('Delete routine', 'Permanently delete this saved routine?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('workout_routines').delete().eq('id', id);
          setSavedRoutines((prev) => prev.filter((r) => r.id !== id));
        },
      },
    ]);
  }

  function loadRoutineToCurrent(routine: SavedRoutine) {
    if (!routine.exercises) return;
    Alert.alert('Load routine', `Replace current workout with "${routine.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Load',
        onPress: () => {
          persistWorkout(
            routine.exercises!.map((e) => ({
              id: `${Date.now()}-${Math.random()}`,
              name: e.name,
              sets: e.sets ?? '',
              reps: e.reps ?? '',
              weight: e.weight ?? '',
              notes: e.notes ?? '',
            }))
          );
          setView('workout');
        },
      },
    ]);
  }

  // ─── Shared tab bar ──────────────────────────────────────────────────────
  function TabBar() {
    return (
      <View className="flex-row mx-4 mt-4 mb-3 bg-stone-200 rounded-xl p-1">
        {([
          ['stats',   'Stats'],
          ['workout', 'Workout'],
          ['saved',   'Saved'],
        ] as const).map(([key, label]) => (
          <Pressable
            key={key}
            className={`flex-1 py-2 rounded-lg items-center ${view === key ? 'bg-white shadow-sm' : ''}`}
            onPress={() => setView(key)}
          >
            <Text className={`text-sm font-semibold ${view === key ? 'text-teal-700' : 'text-stone-500'}`}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    );
  }

  // ─── Stats view ──────────────────────────────────────────────────────────
  if (view === 'stats') {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: '#faf8f3' }}>
        <TabBar />
        <ScrollView
          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Height (one-time) ── */}
          {(userHeight === null || editingHeight) && (
            <View className="mx-4 mb-3 p-4 bg-white rounded-xl shadow">
              <Text className="text-sm font-bold text-stone-700 mb-1">Your Height</Text>
              <Text className="text-xs text-stone-400 mb-3">
                Set this once so we can calculate your BMI from your weight entries.
              </Text>
              <View className="flex-row" style={{ gap: 8 }}>
                <TextInput
                  className="flex-1 border border-stone-200 rounded-lg px-3 py-2.5 text-[15px] text-stone-800"
                  placeholder="e.g. 175"
                  placeholderTextColor="#a8a29e"
                  value={heightInput}
                  onChangeText={setHeightInput}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                  onSubmitEditing={saveHeight}
                />
                <View className="px-3 justify-center">
                  <Text className="text-sm text-stone-400">cm</Text>
                </View>
                <TouchableOpacity
                  className="bg-teal-600 rounded-lg px-4 items-center justify-center"
                  onPress={saveHeight}
                >
                  <Text className="text-white text-sm font-bold">Save</Text>
                </TouchableOpacity>
                {editingHeight && (
                  <TouchableOpacity
                    className="border-[1.5px] border-stone-200 rounded-lg px-3 items-center justify-center"
                    onPress={() => {
                      setEditingHeight(false);
                      setHeightInput('');
                    }}
                  >
                    <Text className="text-sm text-stone-500 font-semibold">Cancel</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {/* ── Add entry card ── */}
          <View className="mx-4 mb-3 p-4 bg-white rounded-xl shadow">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-lg font-bold text-stone-800">Log Entry</Text>
              {userHeight !== null && !editingHeight && (
                <TouchableOpacity
                  onPress={() => {
                    setHeightInput(String(userHeight));
                    setEditingHeight(true);
                  }}
                >
                  <Text className="text-xs text-teal-700 font-semibold">
                    Height: {userHeight} cm · Edit
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity
              className="border border-stone-200 rounded-lg px-3 py-2.5 mb-3"
              onPress={() => setShowStatDatePicker(true)}
            >
              <Text className="text-sm text-stone-600">
                Date: {statDate.toLocaleDateString(undefined, {
                  month: 'short', day: 'numeric', year: 'numeric',
                })}
              </Text>
            </TouchableOpacity>

            {showStatDatePicker && (
              <DateTimePicker
                value={statDate}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={(_, date) => {
                  setShowStatDatePicker(Platform.OS === 'ios');
                  if (date) setStatDate(date);
                }}
              />
            )}

            {MEASUREMENT_FIELDS.map((f) => (
              <View key={f.key} className="flex-row items-center mb-3">
                <Text className="w-20 text-sm font-semibold text-stone-600">{f.label}</Text>
                <TextInput
                  className="flex-1 border border-stone-200 rounded-lg px-3 py-2.5 text-[15px] text-stone-800"
                  placeholder={`e.g. 72.5`}
                  placeholderTextColor="#a8a29e"
                  value={statForm[f.key]}
                  onChangeText={(v) => setStatForm((prev) => ({ ...prev, [f.key]: v }))}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                />
                <Text className="w-10 text-right text-xs text-stone-400 ml-2">{f.unit}</Text>
              </View>
            ))}

            <TextInput
              className="border border-stone-200 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 mb-3"
              placeholder="Notes (optional)…"
              placeholderTextColor="#a8a29e"
              value={statNotes}
              onChangeText={setStatNotes}
              multiline
            />

            <TouchableOpacity
              className="bg-teal-600 rounded-lg py-3 items-center"
              onPress={saveStatEntry}
            >
              <Text className="text-white text-[15px] font-bold">Save Entry</Text>
            </TouchableOpacity>
          </View>

          {/* ── History ── */}
          <Text className="text-[13px] font-semibold text-stone-500 px-4 mb-2">
            History {statHistory.length > 0 ? `(${statHistory.length})` : ''}
          </Text>

          {statHistory.length === 0 ? (
            <Text className="text-center text-stone-400 mt-2 text-sm px-4">
              No entries yet. Log your first measurement above.
            </Text>
          ) : (
            statHistory.map((s) => {
              const isExpanded = expandedStatId === s.id;
              const summaryParts = MEASUREMENT_FIELDS
                .filter((f) => s[f.key] !== null && s[f.key] !== undefined)
                .map((f) => `${f.label} ${s[f.key]}${f.unit}`);
              return (
                <View key={s.id} className="mx-4 mb-3 bg-white rounded-xl shadow-sm overflow-hidden">
                  <TouchableOpacity
                    className="flex-row items-center p-4"
                    onPress={() => setExpandedStatId(isExpanded ? null : s.id)}
                  >
                    <View className="flex-1">
                      <Text className="text-[15px] font-semibold text-stone-800">
                        {formatShortDate(s.recorded_at)}
                      </Text>
                      <Text className="text-xs text-stone-500 mt-0.5" numberOfLines={isExpanded ? 0 : 1}>
                        {summaryParts.join(' · ')}
                      </Text>
                    </View>
                    <TouchableOpacity className="p-1.5 mr-2" onPress={() => confirmDeleteStat(s.id)}>
                      <Text className="text-stone-400 text-[15px]">🗑</Text>
                    </TouchableOpacity>
                    <Text className="text-stone-400 text-xs">{isExpanded ? '▲' : '▼'}</Text>
                  </TouchableOpacity>

                  {isExpanded && (
                    <View className="border-t border-stone-100 px-4 py-3">
                      {MEASUREMENT_FIELDS.map((f) => (
                        s[f.key] !== null && s[f.key] !== undefined ? (
                          <View key={f.key} className="flex-row justify-between py-1">
                            <Text className="text-sm text-stone-500">{f.label}</Text>
                            <Text className="text-sm font-semibold text-stone-700">
                              {s[f.key]} {f.unit}
                            </Text>
                          </View>
                        ) : null
                      ))}
                      {(() => {
                        if (!s.weight || !userHeight) return null;
                        const b = calcBMI(s.weight, userHeight);
                        return (
                          <View className="flex-row justify-between py-1 mt-1 pt-2 border-t border-stone-100">
                            <Text className="text-sm text-stone-500">BMI</Text>
                            <Text className="text-sm font-semibold text-teal-700">
                              {b.toFixed(1)} · {bmiCategory(b)}
                            </Text>
                          </View>
                        );
                      })()}
                      {s.notes ? (
                        <View className="mt-2 pt-2 border-t border-stone-100">
                          <Text className="text-xs text-stone-400 mb-0.5">Notes</Text>
                          <Text className="text-sm text-stone-600">{s.notes}</Text>
                        </View>
                      ) : null}
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─── Saved routines view ─────────────────────────────────────────────────
  if (view === 'saved') {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: '#faf8f3' }}>
        <TabBar />
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
          {savedRoutines.length === 0 ? (
            <Text className="text-center text-stone-400 mt-8 text-sm">
              No saved routines yet. Build a workout and save it to see it here.
            </Text>
          ) : (
            savedRoutines.map((routine) => {
              const isExpanded = expandedRoutineId === routine.id;
              return (
                <View key={routine.id} className="bg-white rounded-xl mb-3 shadow-sm overflow-hidden">
                  <TouchableOpacity
                    className="flex-row items-center p-4"
                    onPress={() => {
                      if (isExpanded) {
                        setExpandedRoutineId(null);
                      } else {
                        setExpandedRoutineId(routine.id);
                        if (!routine.exercises) fetchRoutineExercises(routine.id);
                      }
                    }}
                  >
                    <View className="flex-1">
                      <Text className="text-[15px] font-semibold text-stone-800">
                        {routine.name}
                      </Text>
                      <Text className="text-xs text-stone-400 mt-0.5">
                        Saved {formatShortDate(routine.created_at.split('T')[0])}
                      </Text>
                    </View>
                    <TouchableOpacity className="p-1.5 mr-2" onPress={() => confirmDeleteRoutine(routine.id)}>
                      <Text className="text-stone-400 text-[15px]">🗑</Text>
                    </TouchableOpacity>
                    <Text className="text-stone-400 text-xs">{isExpanded ? '▲' : '▼'}</Text>
                  </TouchableOpacity>

                  {isExpanded && (
                    <View className="border-t border-stone-100 px-4 pb-4">
                      {routine.exercises === undefined ? (
                        <Text className="text-stone-400 text-sm py-3">Loading…</Text>
                      ) : routine.exercises.length === 0 ? (
                        <Text className="text-stone-400 text-sm py-3">No exercises in this routine.</Text>
                      ) : (
                        routine.exercises.map((ex) => (
                          <View key={ex.id} className="py-2 border-b border-stone-100">
                            <Text className="text-sm font-semibold text-stone-700">{ex.name}</Text>
                            <Text className="text-xs text-stone-500 mt-0.5">
                              {[
                                ex.sets ? `${ex.sets} sets` : null,
                                ex.reps ? `${ex.reps} reps` : null,
                                ex.weight ? ex.weight : null,
                              ].filter(Boolean).join(' · ') || '—'}
                            </Text>
                            {ex.notes ? (
                              <Text className="text-xs text-stone-400 mt-0.5">{ex.notes}</Text>
                            ) : null}
                          </View>
                        ))
                      )}
                      {routine.exercises && routine.exercises.length > 0 && (
                        <TouchableOpacity
                          className="mt-3 bg-teal-50 border border-teal-200 rounded-lg py-2.5 items-center"
                          onPress={() => loadRoutineToCurrent(routine)}
                        >
                          <Text className="text-sm font-semibold text-teal-700">Load to Current Workout</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─── Workout view ────────────────────────────────────────────────────────
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: '#faf8f3' }}>
      <TabBar />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Add Exercise card ── */}
        <View className="mx-4 mb-3 p-4 bg-white rounded-xl shadow">
          <Text className="text-lg font-bold text-stone-800 mb-3">Add Exercise</Text>

          {/* Catalog quick-add */}
          <TouchableOpacity
            className="flex-row items-center mb-2"
            onPress={() => setShowCatalog(!showCatalog)}
          >
            <Text className="text-sm font-semibold text-stone-600 mr-1">From Catalog</Text>
            <Text className="text-xs text-stone-400">{showCatalog ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {showCatalog && (
            <View className="mb-3">
              <View className="flex-row flex-wrap mb-2" style={{ gap: 6 }}>
                {exerciseCatalog.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    className="bg-stone-100 rounded-full px-3 py-1.5 border border-stone-200"
                    onPress={() => addFromCatalog(c.name)}
                    onLongPress={() => confirmDeleteCatalog(c)}
                  >
                    <Text className="text-xs text-stone-600 font-medium">+ {c.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View className="flex-row" style={{ gap: 8 }}>
                <TextInput
                  className="flex-1 border border-stone-200 rounded-lg px-3 py-2 text-sm text-stone-800"
                  placeholder="Add exercise to catalog…"
                  placeholderTextColor="#a8a29e"
                  value={newCatalogName}
                  onChangeText={setNewCatalogName}
                  returnKeyType="done"
                  onSubmitEditing={addToCatalog}
                />
                <TouchableOpacity
                  className="bg-teal-600 rounded-lg px-3 py-2 items-center justify-center"
                  onPress={addToCatalog}
                >
                  <Text className="text-white text-sm font-bold">Add</Text>
                </TouchableOpacity>
              </View>
              <Text className="text-[11px] text-stone-400 mt-1">Long-press a chip to remove it</Text>
            </View>
          )}

          <TextInput
            className="border border-stone-200 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 mb-3"
            placeholder="Exercise name…"
            placeholderTextColor="#a8a29e"
            value={exName}
            onChangeText={setExName}
            returnKeyType="next"
          />

          <View className="flex-row mb-3" style={{ gap: 8 }}>
            <TextInput
              className="flex-1 border border-stone-200 rounded-lg px-3 py-2.5 text-[15px] text-stone-800"
              placeholder="Sets"
              placeholderTextColor="#a8a29e"
              value={exSets}
              onChangeText={setExSets}
              keyboardType="number-pad"
            />
            <TextInput
              className="flex-1 border border-stone-200 rounded-lg px-3 py-2.5 text-[15px] text-stone-800"
              placeholder="Reps"
              placeholderTextColor="#a8a29e"
              value={exReps}
              onChangeText={setExReps}
            />
            <TextInput
              className="flex-1 border border-stone-200 rounded-lg px-3 py-2.5 text-[15px] text-stone-800"
              placeholder="Weight"
              placeholderTextColor="#a8a29e"
              value={exWeight}
              onChangeText={setExWeight}
            />
          </View>

          <TextInput
            className="border border-stone-200 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 mb-3"
            placeholder="Notes (optional)…"
            placeholderTextColor="#a8a29e"
            value={exNotes}
            onChangeText={setExNotes}
          />

          <TouchableOpacity
            className="bg-teal-600 rounded-lg py-3 items-center"
            onPress={addExercise}
          >
            <Text className="text-white text-[15px] font-bold">Add to Workout</Text>
          </TouchableOpacity>
        </View>

        {/* ── Save workout / routine ── */}
        {exercises.length > 0 && (
          <View className="mx-4 mb-3 p-4 bg-white rounded-xl shadow">
            <Text className="text-sm font-bold text-stone-700 mb-1">Finish Workout</Text>
            <Text className="text-xs text-stone-400 mb-3">
              Log this as a completed session (shows in planner) or save as a
              reusable routine for next time.
            </Text>
            <View className="flex-row" style={{ gap: 8 }}>
              <TouchableOpacity
                className="flex-1 bg-teal-600 rounded-lg py-2.5 items-center"
                onPress={() => {
                  setSessionDate(new Date());
                  setSessionName('');
                  setShowSessionModal(true);
                }}
              >
                <Text className="text-white text-sm font-bold">Save Workout</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 border-[1.5px] border-teal-600 rounded-lg py-2.5 items-center"
                onPress={() => setShowSaveModal(true)}
              >
                <Text className="text-teal-700 text-sm font-bold">Save as Routine</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Workout header ── */}
        {exercises.length > 0 && (
          <View className="flex-row justify-between items-center px-4 mb-2">
            <Text className="text-[13px] text-stone-500">
              {exercises.length} exercise{exercises.length !== 1 ? 's' : ''}
            </Text>
            <TouchableOpacity onPress={clearWorkout}>
              <Text className="text-[13px] text-rose-700 font-semibold">Clear all</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Exercises list ── */}
        {exercises.length === 0 ? (
          <Text className="text-center text-stone-400 mt-6 text-sm px-4">
            Your workout is empty. Add an exercise above!
          </Text>
        ) : (
          <View className="px-4">
            {exercises.map((ex) => (
              <View
                key={ex.id}
                className="bg-white rounded-[10px] p-3 mb-2 shadow-sm"
              >
                <TouchableOpacity onPress={() => openEditExercise(ex)}>
                  <View className="flex-row items-start">
                    <View className="flex-1">
                      <Text className="text-[15px] font-semibold text-stone-800">{ex.name}</Text>
                      <Text className="text-xs text-stone-500 mt-0.5">
                        {[
                          ex.sets ? `${ex.sets} sets` : null,
                          ex.reps ? `${ex.reps} reps` : null,
                          ex.weight ? ex.weight : null,
                        ].filter(Boolean).join(' · ') || 'Tap to edit'}
                      </Text>
                      {ex.notes ? (
                        <Text className="text-xs text-stone-400 mt-0.5">{ex.notes}</Text>
                      ) : null}
                    </View>
                    <TouchableOpacity className="p-1" onPress={() => confirmDeleteExercise(ex.id)}>
                      <Text className="text-sm text-stone-400">✕</Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* ── Edit-exercise modal ── */}
      <Modal
        visible={editingId !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setEditingId(null)}
      >
        <Pressable
          className="flex-1 bg-black/40 justify-end"
          onPress={() => setEditingId(null)}
        >
          <Pressable className="bg-white rounded-t-[20px] p-6 pb-10" onPress={() => {}}>
            <Text className="text-xl font-bold text-stone-800 mb-4">Edit Exercise</Text>

            <TextInput
              className="border border-stone-200 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 mb-3"
              placeholder="Exercise name…"
              placeholderTextColor="#a8a29e"
              value={editName}
              onChangeText={setEditName}
              autoFocus
            />

            <View className="flex-row mb-3" style={{ gap: 8 }}>
              <TextInput
                className="flex-1 border border-stone-200 rounded-lg px-3 py-2.5 text-[15px] text-stone-800"
                placeholder="Sets"
                placeholderTextColor="#a8a29e"
                value={editSets}
                onChangeText={setEditSets}
                keyboardType="number-pad"
              />
              <TextInput
                className="flex-1 border border-stone-200 rounded-lg px-3 py-2.5 text-[15px] text-stone-800"
                placeholder="Reps"
                placeholderTextColor="#a8a29e"
                value={editReps}
                onChangeText={setEditReps}
              />
              <TextInput
                className="flex-1 border border-stone-200 rounded-lg px-3 py-2.5 text-[15px] text-stone-800"
                placeholder="Weight"
                placeholderTextColor="#a8a29e"
                value={editWeight}
                onChangeText={setEditWeight}
              />
            </View>

            <TextInput
              className="border border-stone-200 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 mb-4"
              placeholder="Notes (optional)…"
              placeholderTextColor="#a8a29e"
              value={editNotes}
              onChangeText={setEditNotes}
            />

            <View className="flex-row" style={{ gap: 12 }}>
              <TouchableOpacity
                className="flex-1 border-[1.5px] border-stone-200 rounded-lg py-3 items-center"
                onPress={() => setEditingId(null)}
              >
                <Text className="text-[15px] font-semibold text-stone-500">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 bg-teal-600 rounded-lg py-3 items-center"
                onPress={saveEditExercise}
              >
                <Text className="text-[15px] font-bold text-white">Save</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Save-workout-session modal ── */}
      <Modal
        visible={showSessionModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowSessionModal(false)}
      >
        <Pressable
          className="flex-1 bg-black/40 justify-end"
          onPress={() => setShowSessionModal(false)}
        >
          <Pressable className="bg-white rounded-t-[20px] p-6 pb-10" onPress={() => {}}>
            <Text className="text-xl font-bold text-stone-800 mb-4">Save Workout</Text>

            <Text className="text-xs font-semibold text-stone-500 mb-1.5">Name (optional)</Text>
            <TextInput
              className="border border-stone-200 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 mb-3"
              placeholder="e.g. Push Day, Legs…"
              placeholderTextColor="#a8a29e"
              value={sessionName}
              onChangeText={setSessionName}
            />

            <Text className="text-xs font-semibold text-stone-500 mb-1.5">Date</Text>
            <TouchableOpacity
              className="border border-stone-200 rounded-lg px-3 py-2.5 mb-4"
              onPress={() => setShowSessionDatePicker(true)}
            >
              <Text className="text-sm text-stone-600">
                {sessionDate.toLocaleDateString(undefined, {
                  weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
                })}
              </Text>
            </TouchableOpacity>
            {showSessionDatePicker && (
              <DateTimePicker
                value={sessionDate}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={(_, date) => {
                  setShowSessionDatePicker(Platform.OS === 'ios');
                  if (date) setSessionDate(date);
                }}
              />
            )}

            <View className="flex-row" style={{ gap: 12 }}>
              <TouchableOpacity
                className="flex-1 border-[1.5px] border-stone-200 rounded-lg py-3 items-center"
                onPress={() => setShowSessionModal(false)}
              >
                <Text className="text-[15px] font-semibold text-stone-500">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 bg-teal-600 rounded-lg py-3 items-center"
                onPress={saveCurrentSession}
              >
                <Text className="text-[15px] font-bold text-white">Save</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Save-routine modal ── */}
      <Modal
        visible={showSaveModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowSaveModal(false)}
      >
        <Pressable
          className="flex-1 bg-black/40 justify-end"
          onPress={() => setShowSaveModal(false)}
        >
          <Pressable className="bg-white rounded-t-[20px] p-6 pb-10" onPress={() => {}}>
            <Text className="text-xl font-bold text-stone-800 mb-4">Save Routine</Text>
            <Text className="text-xs font-semibold text-stone-500 mb-1.5">Name</Text>
            <TextInput
              className="border border-stone-200 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 mb-4"
              placeholder="e.g. Upper Body, Push Day…"
              placeholderTextColor="#a8a29e"
              value={routineName}
              onChangeText={setRoutineName}
              autoFocus
            />

            <View className="flex-row" style={{ gap: 12 }}>
              <TouchableOpacity
                className="flex-1 border-[1.5px] border-stone-200 rounded-lg py-3 items-center"
                onPress={() => setShowSaveModal(false)}
              >
                <Text className="text-[15px] font-semibold text-stone-500">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 bg-teal-600 rounded-lg py-3 items-center"
                onPress={saveCurrentRoutine}
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
