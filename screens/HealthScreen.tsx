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
import StepsCard from '../components/StepsCard';
import { loadData, saveData } from '../utils/storage';
import { deleteRows, insertRows, insertWithChildren, Row, selectRows, upsertByName } from '../utils/localDb';
import { toYMD } from '../utils/dates';
import { useTheme } from '../utils/theme';

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

type WorkoutSession = {
  id: string;
  name: string | null;
  performed_at: string;
  notes: string | null;
  created_at: string;
  /** Stored when saved, so the Planner can show counts without reading every exercise. */
  exercise_count?: number;
  exercises?: SavedRoutineExercise[];
};

/** Row shapes as stored (without the client-only `exercises` field). */
type RoutineRow = Omit<SavedRoutine, 'exercises'> & Row;
type SessionRow = Omit<WorkoutSession, 'exercises'> & Row;
type ExerciseRow = SavedRoutineExercise & Row;

/** Shows a consistent message when on-device storage fails. */
function storageFailed(action: string, e: unknown) {
  console.error(`Failed to ${action}:`, e);
  Alert.alert('Something went wrong', `Could not ${action}. Please try again.`);
}

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
  const theme = useTheme();
  const [view, setView] = useState<'workout' | 'stats'>('workout');

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
  const [showRoutinesPicker, setShowRoutinesPicker] = useState(false);

  // ─── Workout session history state ───────────────────────────────────────
  const [sessionHistory, setSessionHistory] = useState<WorkoutSession[]>([]);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

  // ─── Collapsible-form gates ──────────────────────────────────────────────
  const [builderOpen, setBuilderOpen] = useState(false);
  const [statFormOpen, setStatFormOpen] = useState(false);

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
    if (view === 'workout') fetchSessionHistory();
  }, [view]);

  // ─── Stats (on-device) ───────────────────────────────────────────────────
  async function fetchStatHistory() {
    try {
      setStatHistory(
        await selectRows<HealthStat & Row>('health_stats', { orderBy: 'recorded_at', ascending: false })
      );
    } catch (e) {
      console.error('Failed to load body stats:', e);
    }
  }

  async function saveStatEntry() {
    const parsed = StatsFormSchema.safeParse(statForm);
    if (!parsed.success) {
      Alert.alert('Invalid entry', parsed.error.issues[0]?.message ?? 'Please check the form.');
      return;
    }
    const toNum = (s: string) => (s === '' ? null : Number(s));
    const payload = {
      recorded_at: toYMD(statDate),
      weight: toNum(parsed.data.weight),
      waist:  toNum(parsed.data.waist),
      chest:  toNum(parsed.data.chest),
      hips:   toNum(parsed.data.hips),
      arms:   toNum(parsed.data.arms),
      thighs: toNum(parsed.data.thighs),
      notes: statNotes.trim() || null,
    };
    try {
      await insertRows('health_stats', [payload]);
    } catch (e) {
      storageFailed('save this entry', e);
      return;
    }
    setStatForm({ weight: '', waist: '', chest: '', hips: '', arms: '', thighs: '' });
    setStatNotes('');
    setStatDate(new Date());
    setStatFormOpen(false);
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
          try {
            await deleteRows('health_stats', (r) => r.id === id);
            setStatHistory((prev) => prev.filter((s) => s.id !== id));
          } catch (e) {
            storageFailed('delete this entry', e);
          }
        },
      },
    ]);
  }

  // ─── Routines & catalog (on-device) ──────────────────────────────────────
  async function fetchExerciseCatalog() {
    try {
      setExerciseCatalog(await selectRows<CatalogExercise & Row>('exercise_catalog', { orderBy: 'name' }));
    } catch (e) {
      console.error('Failed to load exercise catalog:', e);
    }
  }

  async function fetchSavedRoutines() {
    try {
      setSavedRoutines(await selectRows<RoutineRow>('workout_routines', { orderBy: 'created_at', ascending: false }));
    } catch (e) {
      console.error('Failed to load routines:', e);
    }
  }

  async function fetchRoutineExercises(routineId: string) {
    try {
      const data = await selectRows<ExerciseRow>('workout_routine_exercises', {
        where: (r) => r.routine_id === routineId,
        orderBy: 'position',
      });
      setSavedRoutines((prev) => prev.map((r) => (r.id === routineId ? { ...r, exercises: data } : r)));
    } catch (e) {
      console.error('Failed to load routine exercises:', e);
    }
  }

  async function fetchSessionHistory() {
    try {
      setSessionHistory(await selectRows<SessionRow>('workout_sessions', { orderBy: 'performed_at', ascending: false }));
    } catch (e) {
      console.error('Failed to load workout history:', e);
    }
  }

  async function fetchSessionExercises(sessionId: string) {
    try {
      const data = await selectRows<ExerciseRow>('workout_session_exercises', {
        where: (r) => r.session_id === sessionId,
        orderBy: 'position',
      });
      setSessionHistory((prev) => prev.map((s) => (s.id === sessionId ? { ...s, exercises: data } : s)));
    } catch (e) {
      console.error('Failed to load workout exercises:', e);
    }
  }

  function confirmDeleteSession(id: string) {
    Alert.alert('Delete workout', 'Permanently delete this workout from history?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteRows('workout_sessions', (r) => r.id === id);
            setSessionHistory((prev) => prev.filter((s) => s.id !== id));
          } catch (e) {
            storageFailed('delete this workout', e);
          }
        },
      },
    ]);
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

    try {
      // Routine and exercises are saved in one write, so a failure can't
      // leave an empty routine behind.
      await insertWithChildren(
        'workout_routines',
        { name: parsed.data },
        'workout_routine_exercises',
        'routine_id',
        exercises.map((e, idx) => ({
          name: e.name,
          sets: e.sets || null,
          reps: e.reps || null,
          weight: e.weight || null,
          notes: e.notes || null,
          position: idx,
        }))
      );
    } catch (e) {
      storageFailed('save this routine', e);
      return;
    }

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

    try {
      await insertWithChildren(
        'workout_sessions',
        { name, performed_at: toYMD(sessionDate), notes: null, exercise_count: exercises.length },
        'workout_session_exercises',
        'session_id',
        exercises.map((e, idx) => ({
          name: e.name,
          sets: e.sets || null,
          reps: e.reps || null,
          weight: e.weight || null,
          notes: e.notes || null,
          position: idx,
        }))
      );
    } catch (e) {
      storageFailed('save this workout', e);
      return;
    }

    setShowSessionModal(false);
    setSessionName('');
    setSessionDate(new Date());
    Alert.alert(
      'Workout saved',
      'View it in the planner on the date you logged it.',
      [
        {
          text: 'OK',
          onPress: () => {
            persistWorkout([]);
            setBuilderOpen(false);
            fetchSessionHistory();
          },
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
    try {
      await upsertByName('exercise_catalog', parsed.data);
    } catch (e) {
      storageFailed('add this exercise', e);
      return;
    }
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
          try {
            await deleteRows('exercise_catalog', (r) => r.id === item.id);
          } catch (e) {
            storageFailed('remove this exercise', e);
          }
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
          try {
            await deleteRows('workout_routines', (r) => r.id === id);
            setSavedRoutines((prev) => prev.filter((r) => r.id !== id));
          } catch (e) {
            storageFailed('delete this routine', e);
          }
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
          setBuilderOpen(true);
          setShowRoutinesPicker(false);
        },
      },
    ]);
  }

  // ─── Shared tab bar ──────────────────────────────────────────────────────
  function TabBar() {
    return (
      <View className="flex-row mx-4 mt-4 mb-3 bg-stone-200 dark:bg-stone-700 rounded-xl p-1">
        {([
          ['workout', 'Workouts'],
          ['stats',   'Stats'],
        ] as const).map(([key, label]) => (
          <Pressable
            key={key}
            className={`flex-1 py-2 rounded-lg items-center ${view === key ? 'bg-white dark:bg-stone-800 shadow-sm' : ''}`}
            onPress={() => setView(key)}
          >
            <Text className={`text-sm font-semibold ${view === key ? 'text-teal-700' : 'text-stone-500 dark:text-stone-400'}`}>
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
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.background }}>
        <TabBar />
        <ScrollView
          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Steps (Android, Health Connect) ── */}
          <StepsCard />

          {/* ── Height (one-time) ── */}
          {(userHeight === null || editingHeight) && (
            <View className="mx-4 mb-3 p-4 bg-white dark:bg-stone-800 rounded-xl shadow">
              <Text className="text-sm font-bold text-stone-700 dark:text-stone-200 mb-1">Your Height</Text>
              <Text className="text-xs text-stone-400 dark:text-stone-500 mb-3">
                Set this once so we can calculate your BMI from your weight entries.
              </Text>
              <View className="flex-row" style={{ gap: 8 }}>
                <TextInput
                  className="flex-1 border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 dark:text-stone-100"
                  placeholder="e.g. 175"
                  placeholderTextColor={theme.placeholder}
                  value={heightInput}
                  onChangeText={setHeightInput}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                  onSubmitEditing={saveHeight}
                />
                <View className="px-3 justify-center">
                  <Text className="text-sm text-stone-400 dark:text-stone-500">cm</Text>
                </View>
                <TouchableOpacity
                  className="bg-teal-600 rounded-lg px-4 items-center justify-center"
                  onPress={saveHeight}
                >
                  <Text className="text-white text-sm font-bold">Save</Text>
                </TouchableOpacity>
                {editingHeight && (
                  <TouchableOpacity
                    className="border-[1.5px] border-stone-200 dark:border-stone-700 rounded-lg px-3 items-center justify-center"
                    onPress={() => {
                      setEditingHeight(false);
                      setHeightInput('');
                    }}
                  >
                    <Text className="text-sm text-stone-500 dark:text-stone-400 font-semibold">Cancel</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {/* ── Log Entry button (collapsed state) ── */}
          {!statFormOpen && (
            <View className="flex-row items-center justify-between mx-4 mb-3">
              <Text className="text-lg font-bold text-stone-800 dark:text-stone-100">
                History {statHistory.length > 0 ? `(${statHistory.length})` : ''}
              </Text>
              <TouchableOpacity
                className="bg-teal-600 rounded-full px-4 py-2"
                onPress={() => setStatFormOpen(true)}
              >
                <Text className="text-white text-sm font-bold">+ Log Entry</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Add entry card ── */}
          {statFormOpen && (
          <View className="mx-4 mb-3 p-4 bg-white dark:bg-stone-800 rounded-xl shadow">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-lg font-bold text-stone-800 dark:text-stone-100">Log Entry</Text>
              <View className="flex-row items-center" style={{ gap: 12 }}>
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
                <TouchableOpacity onPress={() => setStatFormOpen(false)}>
                  <Text className="text-xs font-semibold text-stone-500 dark:text-stone-400">Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              className="border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 mb-3"
              onPress={() => setShowStatDatePicker(true)}
            >
              <Text className="text-sm text-stone-600 dark:text-stone-300">
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
                <Text className="w-20 text-sm font-semibold text-stone-600 dark:text-stone-300">{f.label}</Text>
                <TextInput
                  className="flex-1 border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 dark:text-stone-100"
                  placeholder={`e.g. 72.5`}
                  placeholderTextColor={theme.placeholder}
                  value={statForm[f.key]}
                  onChangeText={(v) => setStatForm((prev) => ({ ...prev, [f.key]: v }))}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                />
                <Text className="w-10 text-right text-xs text-stone-400 dark:text-stone-500 ml-2">{f.unit}</Text>
              </View>
            ))}

            <TextInput
              className="border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 dark:text-stone-100 mb-3"
              placeholder="Notes (optional)…"
              placeholderTextColor={theme.placeholder}
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
          )}

          {/* ── History ── */}
          {statHistory.length === 0 ? (
            <Text className="text-center text-stone-400 dark:text-stone-500 mt-2 text-sm px-4">
              No entries yet. Tap + Log Entry to record your first measurement.
            </Text>
          ) : (
            statHistory.map((s) => {
              const isExpanded = expandedStatId === s.id;
              const summaryParts = MEASUREMENT_FIELDS
                .filter((f) => s[f.key] !== null && s[f.key] !== undefined)
                .map((f) => `${f.label} ${s[f.key]}${f.unit}`);
              return (
                <View key={s.id} className="mx-4 mb-3 bg-white dark:bg-stone-800 rounded-xl shadow-sm overflow-hidden">
                  <TouchableOpacity
                    className="flex-row items-center p-4"
                    onPress={() => setExpandedStatId(isExpanded ? null : s.id)}
                  >
                    <View className="flex-1">
                      <Text className="text-[15px] font-semibold text-stone-800 dark:text-stone-100">
                        {formatShortDate(s.recorded_at)}
                      </Text>
                      <Text className="text-xs text-stone-500 dark:text-stone-400 mt-0.5" numberOfLines={isExpanded ? 0 : 1}>
                        {summaryParts.join(' · ')}
                      </Text>
                    </View>
                    <TouchableOpacity className="p-1.5 mr-2" onPress={() => confirmDeleteStat(s.id)}>
                      <Text className="text-stone-400 dark:text-stone-500 text-[15px]">🗑</Text>
                    </TouchableOpacity>
                    <Text className="text-stone-400 dark:text-stone-500 text-xs">{isExpanded ? '▲' : '▼'}</Text>
                  </TouchableOpacity>

                  {isExpanded && (
                    <View className="border-t border-stone-100 dark:border-stone-700 px-4 py-3">
                      {MEASUREMENT_FIELDS.map((f) => (
                        s[f.key] !== null && s[f.key] !== undefined ? (
                          <View key={f.key} className="flex-row justify-between py-1">
                            <Text className="text-sm text-stone-500 dark:text-stone-400">{f.label}</Text>
                            <Text className="text-sm font-semibold text-stone-700 dark:text-stone-200">
                              {s[f.key]} {f.unit}
                            </Text>
                          </View>
                        ) : null
                      ))}
                      {(() => {
                        if (!s.weight || !userHeight) return null;
                        const b = calcBMI(s.weight, userHeight);
                        return (
                          <View className="flex-row justify-between py-1 mt-1 pt-2 border-t border-stone-100 dark:border-stone-700">
                            <Text className="text-sm text-stone-500 dark:text-stone-400">BMI</Text>
                            <Text className="text-sm font-semibold text-teal-700">
                              {b.toFixed(1)} · {bmiCategory(b)}
                            </Text>
                          </View>
                        );
                      })()}
                      {s.notes ? (
                        <View className="mt-2 pt-2 border-t border-stone-100 dark:border-stone-700">
                          <Text className="text-xs text-stone-400 dark:text-stone-500 mb-0.5">Notes</Text>
                          <Text className="text-sm text-stone-600 dark:text-stone-300">{s.notes}</Text>
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

  // ─── Workout view ────────────────────────────────────────────────────────
  const showBuilder = builderOpen || exercises.length > 0;
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.background }}>
      <TabBar />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Workout history (collapsed state) ── */}
        {!showBuilder && (
          <>
            <View className="flex-row items-center justify-between mx-4 mb-3">
              <Text className="text-lg font-bold text-stone-800 dark:text-stone-100">
                History {sessionHistory.length > 0 ? `(${sessionHistory.length})` : ''}
              </Text>
              <TouchableOpacity
                className="bg-teal-600 rounded-full px-4 py-2"
                onPress={() => setBuilderOpen(true)}
              >
                <Text className="text-white text-sm font-bold">+ Start Workout</Text>
              </TouchableOpacity>
            </View>

            {sessionHistory.length === 0 ? (
              <Text className="text-center text-stone-400 dark:text-stone-500 mt-2 text-sm px-4">
                No workouts yet. Tap + Start Workout to begin.
              </Text>
            ) : (
              sessionHistory.map((s) => {
                const isExpanded = expandedSessionId === s.id;
                return (
                  <View key={s.id} className="mx-4 mb-3 bg-white dark:bg-stone-800 rounded-xl shadow-sm overflow-hidden">
                    <TouchableOpacity
                      className="flex-row items-center p-4"
                      onPress={() => {
                        if (isExpanded) {
                          setExpandedSessionId(null);
                        } else {
                          setExpandedSessionId(s.id);
                          if (!s.exercises) fetchSessionExercises(s.id);
                        }
                      }}
                    >
                      <View className="flex-1">
                        <Text className="text-[15px] font-semibold text-stone-800 dark:text-stone-100">
                          {s.name || 'Workout'}
                        </Text>
                        <Text className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
                          {formatShortDate(s.performed_at)}
                        </Text>
                      </View>
                      <TouchableOpacity className="p-1.5 mr-2" onPress={() => confirmDeleteSession(s.id)}>
                        <Text className="text-stone-400 dark:text-stone-500 text-[15px]">🗑</Text>
                      </TouchableOpacity>
                      <Text className="text-stone-400 dark:text-stone-500 text-xs">{isExpanded ? '▲' : '▼'}</Text>
                    </TouchableOpacity>

                    {isExpanded && (
                      <View className="border-t border-stone-100 dark:border-stone-700 px-4 pb-4">
                        {s.exercises === undefined ? (
                          <Text className="text-stone-400 dark:text-stone-500 text-sm py-3">Loading…</Text>
                        ) : s.exercises.length === 0 ? (
                          <Text className="text-stone-400 dark:text-stone-500 text-sm py-3">No exercises in this workout.</Text>
                        ) : (
                          s.exercises.map((ex) => (
                            <View key={ex.id} className="py-2 border-b border-stone-100 dark:border-stone-700">
                              <Text className="text-sm font-semibold text-stone-700 dark:text-stone-200">{ex.name}</Text>
                              <Text className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                                {[
                                  ex.sets ? `${ex.sets} sets` : null,
                                  ex.reps ? `${ex.reps} reps` : null,
                                  ex.weight ? ex.weight : null,
                                ].filter(Boolean).join(' · ') || '—'}
                              </Text>
                              {ex.notes ? (
                                <Text className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">{ex.notes}</Text>
                              ) : null}
                            </View>
                          ))
                        )}
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </>
        )}

        {/* ── Builder header (with Cancel + Load Routine) ── */}
        {showBuilder && (
          <View className="flex-row items-center justify-between mx-4 mb-3 mt-1">
            <Text className="text-lg font-bold text-stone-800 dark:text-stone-100">Current Workout</Text>
            <View className="flex-row items-center" style={{ gap: 14 }}>
              <TouchableOpacity
                onPress={() => {
                  setShowRoutinesPicker(true);
                  fetchSavedRoutines();
                }}
              >
                <Text className="text-xs font-semibold text-teal-700 dark:text-teal-400">Load Routine</Text>
              </TouchableOpacity>
              {exercises.length === 0 && (
                <TouchableOpacity onPress={() => setBuilderOpen(false)}>
                  <Text className="text-xs font-semibold text-stone-500 dark:text-stone-400">Cancel</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* ── Add Exercise card ── */}
        {showBuilder && (
        <View className="mx-4 mb-3 p-4 bg-white dark:bg-stone-800 rounded-xl shadow">
          <Text className="text-lg font-bold text-stone-800 dark:text-stone-100 mb-3">Add Exercise</Text>

          {/* Catalog quick-add */}
          <TouchableOpacity
            className="flex-row items-center mb-2"
            onPress={() => setShowCatalog(!showCatalog)}
          >
            <Text className="text-sm font-semibold text-stone-600 dark:text-stone-300 mr-1">From Catalog</Text>
            <Text className="text-xs text-stone-400 dark:text-stone-500">{showCatalog ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {showCatalog && (
            <View className="mb-3">
              <View className="flex-row flex-wrap mb-2" style={{ gap: 6 }}>
                {exerciseCatalog.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    className="bg-stone-100 dark:bg-stone-800 rounded-full px-3 py-1.5 border border-stone-200 dark:border-stone-700"
                    onPress={() => addFromCatalog(c.name)}
                    onLongPress={() => confirmDeleteCatalog(c)}
                  >
                    <Text className="text-xs text-stone-600 dark:text-stone-300 font-medium">+ {c.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View className="flex-row" style={{ gap: 8 }}>
                <TextInput
                  className="flex-1 border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-800 dark:text-stone-100"
                  placeholder="Add exercise to catalog…"
                  placeholderTextColor={theme.placeholder}
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
              <Text className="text-[11px] text-stone-400 dark:text-stone-500 mt-1">Long-press a chip to remove it</Text>
            </View>
          )}

          <TextInput
            className="border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 dark:text-stone-100 mb-3"
            placeholder="Exercise name…"
            placeholderTextColor={theme.placeholder}
            value={exName}
            onChangeText={setExName}
            returnKeyType="next"
          />

          <View className="flex-row mb-3" style={{ gap: 8 }}>
            <TextInput
              className="flex-1 border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 dark:text-stone-100"
              placeholder="Sets"
              placeholderTextColor={theme.placeholder}
              value={exSets}
              onChangeText={setExSets}
              keyboardType="number-pad"
            />
            <TextInput
              className="flex-1 border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 dark:text-stone-100"
              placeholder="Reps"
              placeholderTextColor={theme.placeholder}
              value={exReps}
              onChangeText={setExReps}
            />
            <TextInput
              className="flex-1 border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 dark:text-stone-100"
              placeholder="Weight"
              placeholderTextColor={theme.placeholder}
              value={exWeight}
              onChangeText={setExWeight}
            />
          </View>

          <TextInput
            className="border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 dark:text-stone-100 mb-3"
            placeholder="Notes (optional)…"
            placeholderTextColor={theme.placeholder}
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
        )}

        {/* ── Save workout / routine ── */}
        {exercises.length > 0 && (
          <View className="mx-4 mb-3 p-4 bg-white dark:bg-stone-800 rounded-xl shadow">
            <Text className="text-sm font-bold text-stone-700 dark:text-stone-200 mb-1">Finish Workout</Text>
            <Text className="text-xs text-stone-400 dark:text-stone-500 mb-3">
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
            <Text className="text-[13px] text-stone-500 dark:text-stone-400">
              {exercises.length} exercise{exercises.length !== 1 ? 's' : ''}
            </Text>
            <TouchableOpacity onPress={clearWorkout}>
              <Text className="text-[13px] text-rose-700 font-semibold">Clear all</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Exercises list ── */}
        {showBuilder && exercises.length === 0 ? (
          <Text className="text-center text-stone-400 dark:text-stone-500 mt-6 text-sm px-4">
            Your workout is empty. Add an exercise above!
          </Text>
        ) : exercises.length > 0 ? (
          <View className="px-4">
            {exercises.map((ex) => (
              <View
                key={ex.id}
                className="bg-white dark:bg-stone-800 rounded-[10px] p-3 mb-2 shadow-sm"
              >
                <TouchableOpacity onPress={() => openEditExercise(ex)}>
                  <View className="flex-row items-start">
                    <View className="flex-1">
                      <Text className="text-[15px] font-semibold text-stone-800 dark:text-stone-100">{ex.name}</Text>
                      <Text className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                        {[
                          ex.sets ? `${ex.sets} sets` : null,
                          ex.reps ? `${ex.reps} reps` : null,
                          ex.weight ? ex.weight : null,
                        ].filter(Boolean).join(' · ') || 'Tap to edit'}
                      </Text>
                      {ex.notes ? (
                        <Text className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">{ex.notes}</Text>
                      ) : null}
                    </View>
                    <TouchableOpacity className="p-1" onPress={() => confirmDeleteExercise(ex.id)}>
                      <Text className="text-sm text-stone-400 dark:text-stone-500">✕</Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}
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
          <Pressable className="bg-white dark:bg-stone-800 rounded-t-[20px] p-6 pb-10" onPress={() => {}}>
            <Text className="text-xl font-bold text-stone-800 dark:text-stone-100 mb-4">Edit Exercise</Text>

            <TextInput
              className="border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 dark:text-stone-100 mb-3"
              placeholder="Exercise name…"
              placeholderTextColor={theme.placeholder}
              value={editName}
              onChangeText={setEditName}
              autoFocus
            />

            <View className="flex-row mb-3" style={{ gap: 8 }}>
              <TextInput
                className="flex-1 border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 dark:text-stone-100"
                placeholder="Sets"
                placeholderTextColor={theme.placeholder}
                value={editSets}
                onChangeText={setEditSets}
                keyboardType="number-pad"
              />
              <TextInput
                className="flex-1 border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 dark:text-stone-100"
                placeholder="Reps"
                placeholderTextColor={theme.placeholder}
                value={editReps}
                onChangeText={setEditReps}
              />
              <TextInput
                className="flex-1 border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 dark:text-stone-100"
                placeholder="Weight"
                placeholderTextColor={theme.placeholder}
                value={editWeight}
                onChangeText={setEditWeight}
              />
            </View>

            <TextInput
              className="border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 dark:text-stone-100 mb-4"
              placeholder="Notes (optional)…"
              placeholderTextColor={theme.placeholder}
              value={editNotes}
              onChangeText={setEditNotes}
            />

            <View className="flex-row" style={{ gap: 12 }}>
              <TouchableOpacity
                className="flex-1 border-[1.5px] border-stone-200 dark:border-stone-700 rounded-lg py-3 items-center"
                onPress={() => setEditingId(null)}
              >
                <Text className="text-[15px] font-semibold text-stone-500 dark:text-stone-400">Cancel</Text>
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
          <Pressable className="bg-white dark:bg-stone-800 rounded-t-[20px] p-6 pb-10" onPress={() => {}}>
            <Text className="text-xl font-bold text-stone-800 dark:text-stone-100 mb-4">Save Workout</Text>

            <Text className="text-xs font-semibold text-stone-500 dark:text-stone-400 mb-1.5">Name (optional)</Text>
            <TextInput
              className="border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 dark:text-stone-100 mb-3"
              placeholder="e.g. Push Day, Legs…"
              placeholderTextColor={theme.placeholder}
              value={sessionName}
              onChangeText={setSessionName}
            />

            <Text className="text-xs font-semibold text-stone-500 dark:text-stone-400 mb-1.5">Date</Text>
            <TouchableOpacity
              className="border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 mb-4"
              onPress={() => setShowSessionDatePicker(true)}
            >
              <Text className="text-sm text-stone-600 dark:text-stone-300">
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
                className="flex-1 border-[1.5px] border-stone-200 dark:border-stone-700 rounded-lg py-3 items-center"
                onPress={() => setShowSessionModal(false)}
              >
                <Text className="text-[15px] font-semibold text-stone-500 dark:text-stone-400">Cancel</Text>
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
          <Pressable className="bg-white dark:bg-stone-800 rounded-t-[20px] p-6 pb-10" onPress={() => {}}>
            <Text className="text-xl font-bold text-stone-800 dark:text-stone-100 mb-4">Save Routine</Text>
            <Text className="text-xs font-semibold text-stone-500 dark:text-stone-400 mb-1.5">Name</Text>
            <TextInput
              className="border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 dark:text-stone-100 mb-4"
              placeholder="e.g. Upper Body, Push Day…"
              placeholderTextColor={theme.placeholder}
              value={routineName}
              onChangeText={setRoutineName}
              autoFocus
            />

            <View className="flex-row" style={{ gap: 12 }}>
              <TouchableOpacity
                className="flex-1 border-[1.5px] border-stone-200 dark:border-stone-700 rounded-lg py-3 items-center"
                onPress={() => setShowSaveModal(false)}
              >
                <Text className="text-[15px] font-semibold text-stone-500 dark:text-stone-400">Cancel</Text>
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

      {/* ── Load Routine picker modal ── */}
      <Modal
        visible={showRoutinesPicker}
        animationType="slide"
        transparent
        onRequestClose={() => setShowRoutinesPicker(false)}
      >
        <Pressable
          className="flex-1 bg-black/40 justify-end"
          onPress={() => setShowRoutinesPicker(false)}
        >
          <Pressable
            className="bg-white dark:bg-stone-800 rounded-t-[20px] p-6 pb-10"
            style={{ maxHeight: '80%' }}
            onPress={() => {}}
          >
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-xl font-bold text-stone-800 dark:text-stone-100">Load Routine</Text>
              <TouchableOpacity onPress={() => setShowRoutinesPicker(false)}>
                <Text className="text-sm font-semibold text-stone-500 dark:text-stone-400">Close</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {savedRoutines.length === 0 ? (
                <Text className="text-center text-stone-400 dark:text-stone-500 mt-4 mb-2 text-sm">
                  No saved routines yet. Build a workout and tap &quot;Save as Routine&quot; to add one.
                </Text>
              ) : (
                savedRoutines.map((routine) => {
                  const isExpanded = expandedRoutineId === routine.id;
                  return (
                    <View key={routine.id} className="bg-stone-50 dark:bg-stone-900 rounded-xl mb-3 overflow-hidden">
                      <TouchableOpacity
                        className="flex-row items-center p-3"
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
                          <Text className="text-[15px] font-semibold text-stone-800 dark:text-stone-100">
                            {routine.name}
                          </Text>
                          <Text className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
                            Saved {formatShortDate(routine.created_at.split('T')[0])}
                          </Text>
                        </View>
                        <TouchableOpacity className="p-1.5 mr-2" onPress={() => confirmDeleteRoutine(routine.id)}>
                          <Text className="text-stone-400 dark:text-stone-500 text-[15px]">🗑</Text>
                        </TouchableOpacity>
                        <Text className="text-stone-400 dark:text-stone-500 text-xs">{isExpanded ? '▲' : '▼'}</Text>
                      </TouchableOpacity>

                      {isExpanded && (
                        <View className="border-t border-stone-200 dark:border-stone-700 px-3 pb-3">
                          {routine.exercises === undefined ? (
                            <Text className="text-stone-400 dark:text-stone-500 text-sm py-3">Loading…</Text>
                          ) : routine.exercises.length === 0 ? (
                            <Text className="text-stone-400 dark:text-stone-500 text-sm py-3">No exercises in this routine.</Text>
                          ) : (
                            routine.exercises.map((ex) => (
                              <View key={ex.id} className="py-1.5">
                                <Text className="text-sm font-semibold text-stone-700 dark:text-stone-200">{ex.name}</Text>
                                <Text className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                                  {[
                                    ex.sets ? `${ex.sets} sets` : null,
                                    ex.reps ? `${ex.reps} reps` : null,
                                    ex.weight ? ex.weight : null,
                                  ].filter(Boolean).join(' · ') || '—'}
                                </Text>
                              </View>
                            ))
                          )}
                          {routine.exercises && routine.exercises.length > 0 && (
                            <TouchableOpacity
                              className="mt-3 bg-teal-600 rounded-lg py-2.5 items-center"
                              onPress={() => loadRoutineToCurrent(routine)}
                            >
                              <Text className="text-sm font-bold text-white">Load to Current Workout</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
