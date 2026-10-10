import { Linking, Platform } from 'react-native';
import { loadData, saveData } from './storage';

/**
 * Step tracking via Android Health Connect. Health Connect stores the daily
 * step totals the phone already records (Google Fit, Samsung Health, Fitbit…).
 * Android only; requires a development/production build (not Expo Go).
 */

export const STEP_GOAL_KEY = 'health:stepGoal';
export const DEFAULT_STEP_GOAL = 10000;

const HEALTH_CONNECT_PACKAGE = 'com.google.android.apps.healthdata';

export type StepsStatus =
  | 'unsupported'        // not Android, or native module missing (e.g. Expo Go)
  | 'not-installed'      // Health Connect app missing / needs update
  | 'needs-permission'
  | 'ready';

export type DaySteps = { date: string; steps: number }; // date = YYYY-MM-DD

// Loaded lazily so iOS/web never touch the Android-only native module.
type HC = typeof import('react-native-health-connect');
let hc: HC | null | undefined;
function getHC(): HC | null {
  if (hc !== undefined) return hc;
  if (Platform.OS !== 'android') return (hc = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    hc = require('react-native-health-connect') as HC;
  } catch {
    hc = null;
  }
  return hc;
}

const STEPS_PERMISSION = { accessType: 'read', recordType: 'Steps' } as const;

let initialized = false;

export async function getStepsStatus(): Promise<StepsStatus> {
  const lib = getHC();
  if (!lib) return 'unsupported';
  try {
    const sdk = await lib.getSdkStatus();
    if (sdk !== lib.SdkAvailabilityStatus.SDK_AVAILABLE) return 'not-installed';
    if (!initialized) initialized = await lib.initialize();
    if (!initialized) return 'not-installed';
    const granted = await lib.getGrantedPermissions();
    const hasSteps = granted.some(
      (p) => 'recordType' in p && p.recordType === 'Steps' && p.accessType === 'read'
    );
    return hasSteps ? 'ready' : 'needs-permission';
  } catch (e) {
    console.error('Health Connect status check failed:', e);
    return 'unsupported';
  }
}

/** Shows the Health Connect permission sheet. Returns true if steps access was granted. */
export async function requestStepsPermission(): Promise<boolean> {
  const lib = getHC();
  if (!lib) return false;
  try {
    if (!initialized) initialized = await lib.initialize();
    const granted = await lib.requestPermission([STEPS_PERMISSION]);
    return granted.some((p) => 'recordType' in p && p.recordType === 'Steps');
  } catch (e) {
    console.error('Health Connect permission request failed:', e);
    return false;
  }
}

/** Opens the Play Store page for Health Connect (needed on Android 13 and below). */
export function openHealthConnectInstall() {
  Linking.openURL(`market://details?id=${HEALTH_CONNECT_PACKAGE}`).catch(() =>
    Linking.openURL(`https://play.google.com/store/apps/details?id=${HEALTH_CONNECT_PACKAGE}`)
  );
}

export function openHealthConnectSettings() {
  getHC()?.openHealthConnectSettings();
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Daily step totals for the last `days` days (oldest first, today last).
 * Uses aggregation so overlapping sources (phone + watch) aren't double counted.
 */
export async function readDailySteps(days = 7): Promise<DaySteps[]> {
  const lib = getHC();
  if (!lib) return [];
  const results: DaySteps[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    const res = await lib.aggregateRecord({
      recordType: 'Steps',
      timeRangeFilter: {
        operator: 'between',
        startTime: start.toISOString(),
        endTime: (i === 0 ? today : end).toISOString(),
      },
    });
    results.push({ date: ymd(start), steps: res.COUNT_TOTAL ?? 0 });
  }
  return results;
}

export async function loadStepGoal(): Promise<number> {
  const stored = await loadData(STEP_GOAL_KEY);
  return typeof stored === 'number' && stored > 0 ? stored : DEFAULT_STEP_GOAL;
}

export async function saveStepGoal(goal: number) {
  await saveData(STEP_GOAL_KEY, goal);
}
