import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { toYMD } from './dates';
import { deleteRows, insertRows, insertRowUnless, Row, selectRows, updateRows } from './localDb';
import { addDays, addMonthsClamped, daysBetween, monthsBetween } from './recurrence';

// ─── Types ───────────────────────────────────────────────────────────────────

export type Frequency = 'weekly' | 'fortnightly' | 'four_weekly' | 'monthly' | 'quarterly' | 'yearly';

export const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'four_weekly', label: 'Every 4 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

export const CATEGORIES: { name: string; color: string }[] = [
  { name: 'Housing', color: '#0d9488' },
  { name: 'Utilities', color: '#f59e0b' },
  { name: 'Transport', color: '#3b82f6' },
  { name: 'Subscriptions', color: '#8b5cf6' },
  { name: 'Insurance', color: '#ec4899' },
  { name: 'Debt', color: '#ef4444' },
  { name: 'Savings', color: '#22c55e' },
  { name: 'Other', color: '#78716c' },
];

export function categoryColor(name: string) {
  return CATEGORIES.find((c) => c.name === name)?.color ?? '#78716c';
}

/** A bill, subscription or other payment that repeats. */
export type RecurringPayment = Row & {
  name: string;
  amount_minor: number;
  /** Money out (bills) or in (income, from phase 2). */
  direction: 'out' | 'in';
  frequency: Frequency;
  /** First due date of the series (YYYY-MM-DD). Its day is kept for monthly+ repeats. */
  anchor_date: string;
  /** Last date a payment can fall on, or null for no end. */
  end_date: string | null;
  category: string;
  paused: boolean;
  notes?: string;
};

export type RecurringInput = Omit<RecurringPayment, 'id' | 'created_at'>;

/** Money actually paid: a ticked-off bill occurrence (later also unexpected costs). */
export type Transaction = Row & {
  date: string;
  amount_minor: number;
  name: string;
  category: string;
  kind: 'recurring' | 'unexpected';
  recurring_id: string | null;
  /** Which occurrence this pays. `recurring_id` + `due_date` is unique. */
  due_date: string | null;
  notes?: string;
};

// ─── Occurrences ─────────────────────────────────────────────────────────────

const STEP: Record<Frequency, { days: number } | { months: number }> = {
  weekly: { days: 7 },
  fortnightly: { days: 14 },
  four_weekly: { days: 28 },
  monthly: { months: 1 },
  quarterly: { months: 3 },
  yearly: { months: 12 },
};

type Schedule = Pick<RecurringPayment, 'anchor_date' | 'frequency'>;

/** Due date of the `n`th payment (0 = the anchor). Computed from the anchor so it never drifts. */
export function nthOccurrence(p: Schedule, n: number): string {
  const step = STEP[p.frequency];
  return 'days' in step ? addDays(p.anchor_date, step.days * n) : addMonthsClamped(p.anchor_date, step.months * n);
}

/** All due dates of `p` from `from` to `to` inclusive. Ignores `paused`. */
export function occurrencesBetween(
  p: Schedule & Pick<RecurringPayment, 'end_date'>,
  from: string,
  to: string
): string[] {
  const last = p.end_date && p.end_date < to ? p.end_date : to;
  if (last < p.anchor_date || last < from) return [];
  const step = STEP[p.frequency];
  // Jump close to `from` instead of walking from the anchor.
  let n =
    from <= p.anchor_date
      ? 0
      : 'days' in step
      ? Math.floor(daysBetween(p.anchor_date, from) / step.days)
      : Math.max(0, Math.floor(monthsBetween(p.anchor_date, from) / step.months) - 1);
  const dates: string[] = [];
  for (let d = nthOccurrence(p, n); d <= last; d = nthOccurrence(p, ++n)) {
    if (d >= from) dates.push(d);
  }
  return dates;
}

/** The first due date on or after `ymd`, or null if the series has ended. */
export function nextDueOnOrAfter(p: RecurringPayment, ymd: string): string | null {
  // A yearly bill is always due within the next 12 months.
  return occurrencesBetween(p, ymd, addMonthsClamped(ymd, 13))[0] ?? null;
}

/** Average cost per month in pence (may be fractional; round when displaying). */
export function monthlyEquivalent(amountMinor: number, frequency: Frequency): number {
  switch (frequency) {
    case 'weekly':
      return (amountMinor * 52) / 12;
    case 'fortnightly':
      return (amountMinor * 26) / 12;
    case 'four_weekly':
      return (amountMinor * 13) / 12;
    case 'monthly':
      return amountMinor;
    case 'quarterly':
      return amountMinor / 3;
    case 'yearly':
      return amountMinor / 12;
  }
}

export function isActive(p: RecurringPayment, today: string) {
  return !p.paused && (!p.end_date || p.end_date >= today);
}

export type Occurrence = {
  payment: RecurringPayment;
  due: string;
  /** The transaction that paid it, if ticked off. */
  paid: Transaction | null;
};

/** How far back unpaid bills still count as overdue. */
const OVERDUE_LOOKBACK_DAYS = 90;

/**
 * Occurrences of every unpaused bill between `from` and `to`, sorted by date.
 * Dates before the bill was added to the app are skipped, so adding rent that
 * started years ago doesn't produce a pile of "overdue" payments.
 */
export function occurrencesInRange(
  payments: RecurringPayment[],
  transactions: Transaction[],
  from: string,
  to: string
): Occurrence[] {
  const paidBy = new Map<string, Transaction>();
  for (const t of transactions) {
    if (t.recurring_id && t.due_date) paidBy.set(`${t.recurring_id}|${t.due_date}`, t);
  }
  const result: Occurrence[] = [];
  for (const p of payments) {
    if (p.paused) continue;
    const added = toYMD(new Date(p.created_at));
    for (const due of occurrencesBetween(p, from > added ? from : added, to)) {
      result.push({ payment: p, due, paid: paidBy.get(`${p.id}|${due}`) ?? null });
    }
  }
  return result.sort((a, b) => a.due.localeCompare(b.due) || a.payment.name.localeCompare(b.payment.name));
}

export function overdueStart(today: string) {
  return addDays(today, -OVERDUE_LOOKBACK_DAYS);
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Recurring payments and transactions for the Money tab. Reloads on focus.
 * Mutations resolve to `true` when saved; on failure they alert, reload and
 * resolve to `false`.
 */
export function useFinance() {
  const [payments, setPayments] = useState<RecurringPayment[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [p, t] = await Promise.all([
        selectRows<RecurringPayment>('finance_recurring', { orderBy: 'name' }),
        selectRows<Transaction>('finance_transactions', { orderBy: 'date', ascending: false }),
      ]);
      setPayments(p);
      setTransactions(t);
    } catch (e) {
      console.error('Failed to load money data:', e);
    } finally {
      setLoaded(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const run = useCallback(
    async (task: () => Promise<unknown>): Promise<boolean> => {
      try {
        await task();
        return true;
      } catch (e) {
        console.error('Money save failed:', e);
        Alert.alert('Could not save', 'Your change was not saved. Your device storage may be full.');
        return false;
      } finally {
        await reload();
      }
    },
    [reload]
  );

  const addPayment = useCallback(
    (input: RecurringInput) => run(() => insertRows<RecurringPayment>('finance_recurring', [input])),
    [run]
  );

  const updatePayment = useCallback(
    (id: string, input: RecurringInput) =>
      run(() => updateRows('finance_recurring', (r) => r.id === id, () => input)),
    [run]
  );

  /** Deletes the bill. Payments already ticked off stay in the history. */
  const deletePayment = useCallback(
    (id: string) => run(() => deleteRows('finance_recurring', (r) => r.id === id)),
    [run]
  );

  const markPaid = useCallback(
    (occ: Occurrence) =>
      run(() =>
        insertRowUnless<Transaction>(
          'finance_transactions',
          (t) => t.recurring_id === occ.payment.id && t.due_date === occ.due,
          {
            date: toYMD(new Date()),
            amount_minor: occ.payment.amount_minor,
            name: occ.payment.name,
            category: occ.payment.category,
            kind: 'recurring',
            recurring_id: occ.payment.id,
            due_date: occ.due,
          }
        )
      ),
    [run]
  );

  const unmarkPaid = useCallback(
    (occ: Occurrence) =>
      run(() =>
        deleteRows('finance_transactions', (t) => t.recurring_id === occ.payment.id && t.due_date === occ.due)
      ),
    [run]
  );

  return { payments, transactions, loaded, addPayment, updatePayment, deletePayment, markPaid, unmarkPaid };
}
