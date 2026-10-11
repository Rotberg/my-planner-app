import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
  DaySteps,
  getStepsStatus,
  loadStepGoal,
  openHealthConnectInstall,
  openHealthConnectSettings,
  readDailySteps,
  requestStepsPermission,
  saveStepGoal,
  StepsStatus,
} from '../utils/steps';
import { fromYMD } from '../utils/dates';
import { useTheme } from '../utils/theme';

// Validated against both light and dark surfaces (dataviz palette check).
const BAR_COLOR = '#0d9488';
const CHART_HEIGHT = 84;

function dayLabel(ymd: string) {
  return fromYMD(ymd).toLocaleDateString(undefined, { weekday: 'narrow' });
}

function longDate(ymd: string) {
  return fromYMD(ymd).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Android step tracking card backed by Health Connect. Hidden on iOS/web. */
export default function StepsCard() {
  const theme = useTheme();
  const [status, setStatus] = useState<StepsStatus | 'loading'>('loading');
  const [days, setDays] = useState<DaySteps[]>([]);
  const [goal, setGoal] = useState(10000);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Overlapping refreshes (focus + app resume + after granting permission)
  // share one in-flight run instead of reading Health Connect several times.
  const inFlight = useRef<Promise<void> | null>(null);
  /** `fresh` waits for any refresh already running, then always starts a new one. */
  const refresh = useCallback((fresh = false): Promise<void> => {
    if (fresh && inFlight.current) {
      return inFlight.current.then(() => refresh(true));
    }
    if (!inFlight.current) {
      inFlight.current = (async () => {
        const s = await getStepsStatus();
        setStatus(s);
        if (s !== 'ready') return;
        try {
          setDays(await readDailySteps(7));
          setError(null);
        } catch (e) {
          console.warn('Failed to read steps:', e);
          setError('Could not read steps from Health Connect.');
        }
      })().finally(() => {
        inFlight.current = null;
      });
    }
    return inFlight.current;
  }, []);

  useEffect(() => {
    loadStepGoal().then(setGoal);
  }, []);

  // Refresh on focus, and on app resume only while this tab is focused
  // (e.g. returning from Health Connect settings).
  useFocusEffect(
    useCallback(() => {
      refresh();
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') refresh();
      });
      return () => sub.remove();
    }, [refresh])
  );

  async function connect() {
    await requestStepsPermission();
    // A refresh may already be running from the app resuming, started before
    // the grant was visible. Always check again afterwards.
    await refresh(true);
  }

  function submitGoal() {
    const n = Math.round(Number(goalInput));
    if (Number.isFinite(n) && n > 0) {
      setGoal(n);
      saveStepGoal(n);
    }
    setEditingGoal(false);
  }

  if (status === 'unsupported') return null;

  const card = 'mx-4 mb-3 p-4 bg-white dark:bg-stone-800 rounded-xl shadow';

  if (status === 'needs-build') {
    return (
      <View className={card}>
        <Text className="text-sm font-bold text-stone-700 dark:text-stone-200 mb-1">Steps</Text>
        <Text className="text-xs text-stone-500 dark:text-stone-400">
          Step tracking needs the installed app build, because it uses Health Connect. It isn&apos;t
          available when running in Expo Go.
        </Text>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View className={card}>
        <Text className="text-sm font-bold text-stone-700 dark:text-stone-200 mb-1">Steps</Text>
        <Text className="text-xs text-stone-500 dark:text-stone-400 mb-3">
          Couldn&apos;t reach Health Connect just now.
        </Text>
        <TouchableOpacity className="bg-teal-600 rounded-lg py-2.5 items-center" onPress={() => refresh(true)}>
          <Text className="text-white text-sm font-bold">Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (status === 'loading') {
    return (
      <View className={card}>
        <ActivityIndicator color={BAR_COLOR} />
      </View>
    );
  }

  if (status === 'not-installed' || status === 'needs-permission') {
    const needsInstall = status === 'not-installed';
    return (
      <View className={card}>
        <Text className="text-sm font-bold text-stone-700 dark:text-stone-200 mb-1">Steps</Text>
        <Text className="text-xs text-stone-500 dark:text-stone-400 mb-3">
          {needsInstall
            ? 'Step tracking uses Health Connect. Install or update it from the Play Store, then come back.'
            : 'Allow access to your step count in Health Connect to see daily steps here.'}
        </Text>
        <TouchableOpacity
          className="bg-teal-600 rounded-lg py-2.5 items-center"
          onPress={needsInstall ? openHealthConnectInstall : connect}
        >
          <Text className="text-white text-sm font-bold">
            {needsInstall ? 'Get Health Connect' : 'Connect steps'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const today = days[days.length - 1];
  const todaySteps = today?.steps ?? 0;
  const pct = Math.min(100, Math.round((todaySteps / goal) * 100));
  const scaleMax = Math.max(goal, ...days.map((d) => d.steps), 1);
  const goalY = (goal / scaleMax) * CHART_HEIGHT;
  const focusIdx = selected ?? days.length - 1;
  const focus = days[focusIdx];

  return (
    <View className={card}>
      {/* Hero number */}
      <View className="flex-row items-start justify-between">
        <View>
          <Text className="text-sm font-bold text-stone-700 dark:text-stone-200">Steps today</Text>
          <Text className="text-3xl font-bold text-stone-800 dark:text-stone-100 mt-0.5">
            {todaySteps.toLocaleString()}
          </Text>
        </View>
        <TouchableOpacity onPress={() => { setGoalInput(String(goal)); setEditingGoal(true); }}>
          <Text className="text-xs text-stone-500 dark:text-stone-400 text-right">Goal</Text>
          <Text className="text-sm font-semibold text-stone-700 dark:text-stone-200 text-right">
            {goal.toLocaleString()} ✎
          </Text>
        </TouchableOpacity>
      </View>

      {editingGoal && (
        <View className="flex-row mt-2" style={{ gap: 8 }}>
          <TextInput
            className="flex-1 border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-800 dark:text-stone-100"
            value={goalInput}
            onChangeText={setGoalInput}
            keyboardType="number-pad"
            autoFocus
            onSubmitEditing={submitGoal}
            placeholder="Daily goal"
            placeholderTextColor={theme.placeholder}
          />
          <TouchableOpacity className="bg-teal-600 rounded-lg px-3 items-center justify-center" onPress={submitGoal}>
            <Text className="text-white text-sm font-bold">Save</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Goal progress */}
      <View className="h-2 rounded-full bg-stone-100 dark:bg-stone-700 overflow-hidden mt-3">
        <View className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: BAR_COLOR }} />
      </View>
      <Text className="text-xs text-stone-500 dark:text-stone-400 mt-1">
        {pct >= 100 ? '✓ Goal reached' : `${pct}% of daily goal`}
      </Text>

      {error ? <Text className="text-xs text-rose-600 mt-2">{error}</Text> : null}

      {/* Last 7 days. Tap a bar to see its value. */}
      {days.length > 0 && (
        <>
          <View className="flex-row items-baseline justify-between mt-4 mb-2">
            <Text className="text-xs font-semibold text-stone-500 dark:text-stone-400">Last 7 days</Text>
            {focus && (
              <Text className="text-xs text-stone-700 dark:text-stone-200">
                {longDate(focus.date)} · <Text className="font-bold">{focus.steps.toLocaleString()}</Text>
              </Text>
            )}
          </View>
          <View style={{ height: CHART_HEIGHT }}>
            {/* Goal reference line */}
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: goalY,
                borderTopWidth: 1,
                borderStyle: 'dashed',
                borderColor: theme.border,
              }}
            />
            <View className="flex-1 flex-row items-end" style={{ gap: 2 }}>
              {days.map((d, i) => {
                const h = Math.max(2, (d.steps / scaleMax) * CHART_HEIGHT);
                const isFocus = i === focusIdx;
                return (
                  <TouchableOpacity
                    key={d.date}
                    className="flex-1 items-center justify-end"
                    style={{ height: CHART_HEIGHT }}
                    onPress={() => setSelected(i)}
                    accessibilityLabel={`${longDate(d.date)}: ${d.steps} steps`}
                  >
                    <View
                      style={{
                        width: '55%',
                        height: h,
                        backgroundColor: BAR_COLOR,
                        opacity: isFocus ? 1 : 0.55,
                        borderTopLeftRadius: 4,
                        borderTopRightRadius: 4,
                      }}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
          <View className="flex-row mt-1" style={{ gap: 2 }}>
            {days.map((d, i) => (
              <Text
                key={d.date}
                className={`flex-1 text-center text-[10px] ${i === focusIdx ? 'font-bold text-stone-700 dark:text-stone-200' : 'text-stone-400 dark:text-stone-500'}`}
              >
                {dayLabel(d.date)}
              </Text>
            ))}
          </View>
        </>
      )}

      <TouchableOpacity className="mt-3" onPress={openHealthConnectSettings}>
        <Text className="text-[11px] text-stone-400 dark:text-stone-500">Manage in Health Connect ›</Text>
      </TouchableOpacity>
    </View>
  );
}
