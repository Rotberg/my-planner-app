import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { fromYMD, toYMD } from './dates';
import { nextReminder, RecurringPayment, Transaction } from './finance';
import { selectRows } from './localDb';
import { formatMoney } from './money';
import { daysBetween } from './recurrence';

/**
 * Bill reminders. Each bill has at most one scheduled notification, for its
 * next unpaid occurrence, under the fixed identifier `bill-reminder:<id>`.
 * Scheduling only the next one keeps well under iOS's 64 pending
 * notifications; re-syncing (on launch, on Money tab focus and after every
 * change) moves each reminder on once a bill is paid or its date passes.
 */

const PREFIX = 'bill-reminder:';
export const BILLS_CHANNEL = 'bills';

/** "today", "tomorrow" or "on Thursday 23 Oct". */
function dueWhen(due: string, at: Date) {
  const days = daysBetween(toYMD(at), due);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `on ${fromYMD(due).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}`;
}

async function sync(data?: { payments: RecurringPayment[]; transactions: Transaction[] }) {
  if (Platform.OS === 'web') return;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  const { payments, transactions } = data ?? {
    payments: await selectRows<RecurringPayment>('finance_recurring'),
    transactions: await selectRows<Transaction>('finance_transactions'),
  };

  // Cancel every bill reminder (including ones for deleted bills), then
  // schedule the current set. There are only ever a handful.
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => n.identifier.startsWith(PREFIX))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
  );

  const now = new Date();
  for (const p of payments) {
    const next = nextReminder(p, transactions, now);
    if (!next) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: `${PREFIX}${p.id}`,
      content: {
        title: `${p.name} is due ${dueWhen(next.due, next.at)}`,
        body: `${formatMoney(p.amount_minor)} · Tap to open the Money tab`,
        sound: 'default',
        data: { url: '/money' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: next.at, channelId: BILLS_CHANNEL },
    });
  }
}

let queue: Promise<void> = Promise.resolve();

/**
 * Re-schedules all bill reminders. Pass the current data to skip reading it
 * again. Runs one at a time, so overlapping calls can't double-schedule.
 * Never throws: a failed sync is logged and retried on the next call.
 */
export function syncBillReminders(data?: { payments: RecurringPayment[]; transactions: Transaction[] }) {
  queue = queue.then(() =>
    sync(data).catch((e) => console.warn('Could not schedule bill reminders:', e))
  );
  return queue;
}
