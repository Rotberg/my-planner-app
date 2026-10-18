import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { fromYMD, toYMD } from './dates';
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

type Category = { name: string; color: string };

export const CATEGORIES: Category[] = [
  { name: 'Housing', color: '#0d9488' },
  { name: 'Utilities', color: '#f59e0b' },
  { name: 'Transport', color: '#3b82f6' },
  { name: 'Subscriptions', color: '#8b5cf6' },
  { name: 'Insurance', color: '#ec4899' },
  { name: 'Debt', color: '#ef4444' },
  { name: 'Savings', color: '#22c55e' },
  { name: 'Other', color: '#78716c' },
];

export const INCOME_CATEGORIES: Category[] = [
  { name: 'Salary', color: '#16a34a' },
  { name: 'Benefits', color: '#0891b2' },
  { name: 'Side income', color: '#65a30d' },
  { name: 'Other income', color: '#78716c' },
];

export const UNEXPECTED_CATEGORIES: Category[] = [
  { name: 'Car', color: '#3b82f6' },
  { name: 'Home repairs', color: '#f59e0b' },
  { name: 'Health', color: '#ec4899' },
  { name: 'Pets', color: '#a16207' },
  { name: 'Gifts', color: '#8b5cf6' },
  { name: 'Tech', color: '#0891b2' },
  { name: 'Fees & fines', color: '#ef4444' },
  { name: 'Other', color: '#78716c' },
];

export function categoryColor(name: string) {
  return (
    [...CATEGORIES, ...INCOME_CATEGORIES, ...UNEXPECTED_CATEGORIES].find((c) => c.name === name)?.color ?? '#78716c'
  );
}

/** A bill, subscription, income or other payment that repeats. */
export type RecurringPayment = Row & {
  name: string;
  amount_minor: number;
  /** Money out (bills) or in (income). */
  direction: 'out' | 'in';
  frequency: Frequency;
  /** First due date of the series (YYYY-MM-DD). Its day is kept for monthly+ repeats. */
  anchor_date: string;
  /** Last date a payment can fall on, or null for no end. */
  end_date: string | null;
  category: string;
  paused: boolean;
  notes?: string;
  /** Days before each due date to send a reminder (0 = on the day), or null/missing for none. */
  remind_days_before?: number | null;
  /** Amount changes, oldest first. Recorded automatically when the amount is edited. */
  price_history?: PriceChange[];
};

export type PriceChange = { from_minor: number; to_minor: number; date: string };

export type RecurringInput = Omit<RecurringPayment, 'id' | 'created_at' | 'price_history'>;

export const REMINDER_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'Off' },
  { value: 0, label: 'On the day' },
  { value: 1, label: '1 day before' },
  { value: 3, label: '3 days before' },
  { value: 7, label: '7 days before' },
];

export const DEFAULT_REMINDER_DAYS = 3;

/** Money actually paid: a ticked-off bill occurrence, or an unexpected cost. */
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

export type UnexpectedInput = Pick<Transaction, 'date' | 'amount_minor' | 'name' | 'category' | 'notes'>;

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

/** The first due date on or after `ymd` that hasn't been ticked off, or null. */
export function nextUnpaidDue(p: RecurringPayment, transactions: Transaction[], ymd: string): string | null {
  return (
    occurrencesInRange([{ ...p, paused: false }], transactions, ymd, addMonthsClamped(ymd, 13)).find(
      (o) => !isSettled(o)
    )?.due ?? null
  );
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
  /**
   * Due before the bill was added to the app. Counted as paid (so adding rent
   * that started years ago doesn't produce a pile of "overdue" payments), but
   * can't be unticked because there's no transaction to remove.
   */
  assumed: boolean;
};

export const isSettled = (o: Occurrence) => !!o.paid || o.assumed;

/** What an occurrence costs: the amount actually paid, or the bill's current amount. */
export const occurrenceAmount = (o: Occurrence) => o.paid?.amount_minor ?? o.payment.amount_minor;

/** How far back unpaid bills still count as overdue. */
const OVERDUE_LOOKBACK_DAYS = 90;

/** Occurrences of every unpaused payment between `from` and `to`, sorted by date. */
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
    for (const due of occurrencesBetween(p, from, to)) {
      const paid = paidBy.get(`${p.id}|${due}`) ?? null;
      result.push({ payment: p, due, paid, assumed: !paid && due < added });
    }
  }
  return result.sort((a, b) => a.due.localeCompare(b.due) || a.payment.name.localeCompare(b.payment.name));
}

export function overdueStart(today: string) {
  return addDays(today, -OVERDUE_LOOKBACK_DAYS);
}

/** Hour of day reminders are sent at. */
const REMINDER_HOUR = 9;

/**
 * When to remind about `p`: the first unpaid occurrence whose reminder time
 * (9am, `remind_days_before` days ahead of the due date) is still in the
 * future. Null for income, paused/ended bills, or reminders turned off.
 */
export function nextReminder(
  p: RecurringPayment,
  transactions: Transaction[],
  now: Date
): { at: Date; due: string } | null {
  const days = p.remind_days_before;
  const today = toYMD(now);
  if (p.direction !== 'out' || days == null || !isActive(p, today)) return null;
  for (const o of occurrencesInRange([p], transactions, today, addMonthsClamped(today, 13))) {
    if (isSettled(o)) continue;
    const at = fromYMD(addDays(o.due, -days));
    at.setHours(REMINDER_HOUR, 0, 0, 0);
    if (at > now) return { at, due: o.due };
  }
  return null;
}

/** The most recent price change, if it happened within `withinDays` of `today`. */
export function recentPriceChange(p: RecurringPayment, today: string, withinDays = 60): PriceChange | null {
  const last = p.price_history?.[p.price_history.length - 1];
  return last && daysBetween(last.date, today) <= withinDays ? last : null;
}

// ─── Budget periods ──────────────────────────────────────────────────────────

/** A budget period: a calendar month, or payday to the day before the next payday. */
export type Period = { start: string; end: string };

/** The period containing `ymd`. `startDay` is 1–28, so every month has it. */
export function periodFor(ymd: string, startDay: number): Period {
  const d = fromYMD(ymd);
  let y = d.getFullYear();
  let m = d.getMonth();
  if (d.getDate() < startDay) {
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
  }
  const start = toYMD(new Date(y, m, startDay));
  return { start, end: addDays(addMonthsClamped(start, 1), -1) };
}

/** The period `n` periods after `p` (negative for earlier). */
export function shiftPeriod(p: Period, n: number, startDay: number): Period {
  return periodFor(addMonthsClamped(p.start, n), startDay);
}

/** "October 2026" for calendar months, otherwise "25 Sep – 24 Oct". */
export function periodLabel(p: Period, startDay: number) {
  const fmt = (ymd: string, opts: Intl.DateTimeFormatOptions) => fromYMD(ymd).toLocaleDateString('en-GB', opts);
  if (startDay === 1) return fmt(p.start, { month: 'long', year: 'numeric' });
  return `${fmt(p.start, { day: 'numeric', month: 'short' })} – ${fmt(p.end, { day: 'numeric', month: 'short' })}`;
}

export type PeriodSummary = {
  /** Expected income in the period (received amount where ticked). */
  income: number;
  bills: number;
  billsPaid: number;
  billsDue: number;
  unexpected: number;
  unexpectedCount: number;
  buffer: number;
  /** Buffer, or unexpected spend if it went over: the buffer covers surprises up to its size. */
  setAside: number;
  /** income − bills − setAside. Only meaningful when `hasIncome`. */
  leftToSpend: number;
  /** bills + setAside: everything spoken for, for users who don't track income. */
  committed: number;
  hasIncome: boolean;
};

export function summarisePeriod(
  payments: RecurringPayment[],
  transactions: Transaction[],
  period: Period,
  bufferMinor: number
): PeriodSummary {
  const occ = occurrencesInRange(payments, transactions, period.start, period.end);
  const sum = (list: Occurrence[]) => list.reduce((s, o) => s + occurrenceAmount(o), 0);
  const outs = occ.filter((o) => o.payment.direction === 'out');
  const unexpected = transactions.filter(
    (t) => t.kind === 'unexpected' && t.date >= period.start && t.date <= period.end
  );
  const income = sum(occ.filter((o) => o.payment.direction === 'in'));
  const bills = sum(outs);
  const unexpectedTotal = unexpected.reduce((s, t) => s + t.amount_minor, 0);
  const setAside = Math.max(bufferMinor, unexpectedTotal);
  return {
    income,
    bills,
    billsPaid: sum(outs.filter(isSettled)),
    billsDue: sum(outs.filter((o) => !isSettled(o))),
    unexpected: unexpectedTotal,
    unexpectedCount: unexpected.length,
    buffer: bufferMinor,
    setAside,
    leftToSpend: income - bills - setAside,
    committed: bills + setAside,
    hasIncome: payments.some((p) => p.direction === 'in'),
  };
}

// ─── Settings ────────────────────────────────────────────────────────────────

export type FinanceSettings = {
  /** Day of the month a budget period starts on (1–28). 1 = calendar months. */
  periodStartDay: number;
  /** Money set aside each period for unexpected costs, in pence. 0 = no buffer. */
  bufferMinor: number;
  hideIncomeHint: boolean;
};

export const DEFAULT_SETTINGS: FinanceSettings = { periodStartDay: 1, bufferMinor: 0, hideIncomeHint: false };

const SETTINGS_KEY = 'finance:settings';

async function loadSettings(): Promise<FinanceSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const s = { ...DEFAULT_SETTINGS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
    // Fall back to defaults for anything out of range rather than failing.
    if (!Number.isInteger(s.periodStartDay) || s.periodStartDay < 1 || s.periodStartDay > 28) s.periodStartDay = 1;
    if (!Number.isSafeInteger(s.bufferMinor) || s.bufferMinor < 0) s.bufferMinor = 0;
    s.hideIncomeHint = s.hideIncomeHint === true;
    return s;
  } catch (e) {
    console.warn('Could not read money settings, using defaults:', e);
    return DEFAULT_SETTINGS;
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Payments, transactions and settings for the Money tab. Reloads on focus.
 * Mutations resolve to `true` when saved; on failure they alert, reload and
 * resolve to `false`.
 */
export function useFinance() {
  const [payments, setPayments] = useState<RecurringPayment[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [settings, setSettings] = useState<FinanceSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [p, t, s] = await Promise.all([
        selectRows<RecurringPayment>('finance_recurring', { orderBy: 'name' }),
        selectRows<Transaction>('finance_transactions', { orderBy: 'date', ascending: false }),
        loadSettings(),
      ]);
      setPayments(p);
      setTransactions(t);
      setSettings(s);
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

  /** Saves edits. A changed amount is added to the bill's price history. */
  const updatePayment = useCallback(
    (id: string, input: RecurringInput) =>
      run(() =>
        updateRows(
          'finance_recurring',
          (r) => r.id === id,
          (r) =>
            r.amount_minor === input.amount_minor
              ? input
              : {
                  ...input,
                  price_history: [
                    ...(r.price_history ?? []),
                    { from_minor: r.amount_minor, to_minor: input.amount_minor, date: toYMD(new Date()) },
                  ],
                }
        )
      ),
    [run]
  );

  /** Deletes the payment. Occurrences already ticked off stay in the history. */
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

  const addUnexpected = useCallback(
    (input: UnexpectedInput) =>
      run(() =>
        insertRows<Transaction>('finance_transactions', [
          { ...input, kind: 'unexpected', recurring_id: null, due_date: null },
        ])
      ),
    [run]
  );

  const updateUnexpected = useCallback(
    (id: string, input: UnexpectedInput) =>
      run(() => updateRows('finance_transactions', (t) => t.id === id, () => input)),
    [run]
  );

  const deleteTransaction = useCallback(
    (id: string) => run(() => deleteRows('finance_transactions', (t) => t.id === id)),
    [run]
  );

  const saveSettings = useCallback(
    (patch: Partial<FinanceSettings>) =>
      run(async () => {
        // Merge with what's stored, not what's on screen, so two quick saves can't undo each other.
        const next = { ...(await loadSettings()), ...patch };
        await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      }),
    [run]
  );

  return {
    payments,
    transactions,
    settings,
    loaded,
    addPayment,
    updatePayment,
    deletePayment,
    markPaid,
    unmarkPaid,
    addUnexpected,
    updateUnexpected,
    deleteTransaction,
    saveSettings,
  };
}
