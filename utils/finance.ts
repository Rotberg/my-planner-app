import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { fromYMD, todayYMD, toYMD } from './dates';
import { deleteRows, insertRows, insertRowsUnless, insertRowUnless, Row, selectRows, updateRows } from './localDb';
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

const CATEGORY_COLORS = new Map(
  [...UNEXPECTED_CATEGORIES, ...INCOME_CATEGORIES, ...CATEGORIES].map((c) => [c.name, c.color])
);

export function categoryColor(name: string) {
  return CATEGORY_COLORS.get(name) ?? '#78716c';
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
  /**
   * Payments due before this date count as already paid without a tick (e.g.
   * rent that started years ago). Null: none are assumed. Missing (bills saved
   * before this field existed): the date the bill was added.
   */
  paid_before?: string | null;
  /** Unpaid payments due before this date are skipped, e.g. months the bill was paused. */
  skip_before?: string | null;
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
  /** Unexpected cost paid from a savings pot instead of the buffer. */
  pot_id?: string | null;
  notes?: string;
};

export type UnexpectedInput = Pick<Transaction, 'date' | 'amount_minor' | 'name' | 'category' | 'notes' | 'pot_id'>;

/**
 * A savings pot for a cost you know is coming (car insurance, Christmas).
 * Money is "put in" each period on paper, not moved between accounts.
 */
export type Pot = Row & {
  name: string;
  /** What you're saving towards, or null for an open-ended pot. */
  target_minor: number | null;
  /** When you need it by, or null. */
  target_date: string | null;
  /** Work out each period's amount from the target and date (needs both). */
  auto: boolean;
  /** Fixed amount per period when not `auto`. */
  monthly_minor: number;
};

export type PotInput = Omit<Pot, 'id' | 'created_at'>;

/** Money put into (or taken out of) a pot. Spends come from transactions with `pot_id`. */
export type PotEntry = Row & {
  pot_id: string;
  kind: 'contribution' | 'adjustment';
  amount_minor: number;
  /** Start of the budget period this belongs to. */
  period_start: string;
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

/**
 * The date of the `count`th payment from `from` onwards, following the real
 * schedule (so a bill on the 31st isn't cut short by passing through a
 * shorter month). Used to turn "after N payments" into an end date.
 */
export function endAfterPayments(p: Schedule, from: string, count: number): string | null {
  const dues = occurrencesBetween({ ...p, end_date: null }, from, addMonthsClamped(from, 12 * count + 12));
  return dues[count - 1] ?? null;
}

/** The first due date on or after `ymd`, or null if the series has ended. */
export function nextDueOnOrAfter(p: RecurringPayment, ymd: string): string | null {
  // A yearly bill is always due within the next 12 months.
  return occurrencesBetween(p, ymd, addMonthsClamped(ymd, 13))[0] ?? null;
}

/** Unpaid due dates of `p` from `ymd` onwards (a year ahead covers every frequency). */
function unpaidDuesFrom(p: RecurringPayment, transactions: Transaction[], ymd: string): string[] {
  return occurrencesInRange([p], transactions, ymd, addMonthsClamped(ymd, 13))
    .filter((o) => !isSettled(o))
    .map((o) => o.due);
}

/** The first due date on or after `ymd` that hasn't been ticked off, or null. */
export function nextUnpaidDue(p: RecurringPayment, transactions: Transaction[], ymd: string): string | null {
  return unpaidDuesFrom(p, transactions, ymd)[0] ?? null;
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
   * Due before the bill's `paid_before` date. Counted as paid (so adding rent
   * that started years ago doesn't produce a pile of "overdue" payments), but
   * can't be unticked because there's no transaction to remove.
   */
  assumed: boolean;
  /**
   * A ticked-off payment that's no longer part of the bill's live schedule:
   * the bill was paused, deleted, or moved to a new date. Kept so paid
   * history and totals don't change.
   */
  detached?: boolean;
  /** The bill itself has been deleted (`payment` is rebuilt from the payment record). */
  deleted?: boolean;
};

export const isSettled = (o: Occurrence) => !!o.paid || o.assumed;

/** What an occurrence costs: the amount actually paid, or the bill's current amount. */
export const occurrenceAmount = (o: Occurrence) => o.paid?.amount_minor ?? o.payment.amount_minor;

/** How far back unpaid bills still count as overdue. */
const OVERDUE_LOOKBACK_DAYS = 90;

/**
 * Occurrences of every unpaused payment between `from` and `to`, sorted by date.
 *
 * Payments already ticked off are always included, even if their bill has
 * since been paused, re-scheduled or deleted, so paid totals never change
 * after the fact. Pass `allPayments` (every stored payment) to include those
 * of deleted bills; without it only `payments`' own ticks are considered.
 */
export function occurrencesInRange(
  payments: RecurringPayment[],
  transactions: Transaction[],
  from: string,
  to: string,
  allPayments?: RecurringPayment[]
): Occurrence[] {
  const paidBy = new Map<string, Transaction>();
  for (const t of transactions) {
    if (t.recurring_id && t.due_date) paidBy.set(`${t.recurring_id}|${t.due_date}`, t);
  }
  const used = new Set<string>();
  const result: Occurrence[] = [];
  for (const p of payments) {
    if (p.paused) continue;
    const paidBefore = p.paid_before === undefined ? toYMD(new Date(p.created_at)) : p.paid_before;
    for (const due of occurrencesBetween(p, from, to)) {
      const key = `${p.id}|${due}`;
      const paid = paidBy.get(key) ?? null;
      if (!paid && p.skip_before && due < p.skip_before) continue;
      if (paid) used.add(key);
      result.push({ payment: p, due, paid, assumed: !paid && paidBefore != null && due < paidBefore });
    }
  }
  const byId = new Map(payments.map((p) => [p.id, p]));
  const known = allPayments ? new Set(allPayments.map((p) => p.id)) : null;
  for (const [key, t] of paidBy) {
    if (used.has(key) || t.due_date! < from || t.due_date! > to) continue;
    const p = byId.get(t.recurring_id!);
    if (p) {
      result.push({ payment: p, due: t.due_date!, paid: t, assumed: false, detached: true });
    } else if (known && !known.has(t.recurring_id!)) {
      result.push({
        payment: {
          id: t.recurring_id!,
          created_at: t.created_at,
          name: t.name,
          amount_minor: t.amount_minor,
          direction: 'out',
          frequency: 'monthly',
          anchor_date: t.due_date!,
          end_date: t.due_date!,
          category: t.category,
          paused: false,
        },
        due: t.due_date!,
        paid: t,
        assumed: false,
        detached: true,
        deleted: true,
      });
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
 * When to remind about `p`, for its first unpaid occurrence: 9am,
 * `remind_days_before` days ahead of the due date. If that time has already
 * passed (e.g. the bill was added two days before it's due), the next 9am
 * that's still on or before the due date is used instead. Null for income,
 * paused/ended bills, or reminders turned off.
 */
export function nextReminder(
  p: RecurringPayment,
  transactions: Transaction[],
  now: Date
): { at: Date; due: string } | null {
  const days = p.remind_days_before;
  const today = toYMD(now);
  if (p.direction !== 'out' || days == null || !isActive(p, today)) return null;
  const next9am = fromYMD(now.getHours() < REMINDER_HOUR ? today : addDays(today, 1));
  next9am.setHours(REMINDER_HOUR, 0, 0, 0);
  for (const due of unpaidDuesFrom(p, transactions, today)) {
    const planned = fromYMD(addDays(due, -days));
    planned.setHours(REMINDER_HOUR, 0, 0, 0);
    const at = planned > now ? planned : next9am;
    if (toYMD(at) <= due) return { at, due };
  }
  return null;
}

/**
 * Price history after changing `p`'s amount to `to` on `today`. Edits on the
 * day the bill was added, or on the same day as the last change, are treated
 * as corrections: they don't add a new entry (and cancel out if the amount
 * goes back to where it was).
 */
export function recordPriceChange(p: RecurringPayment, to: number, today: string): PriceChange[] {
  const history = p.price_history ?? [];
  const last = history[history.length - 1];
  if (last && last.date === today) {
    const rest = history.slice(0, -1);
    return last.from_minor === to ? rest : [...rest, { ...last, to_minor: to }];
  }
  if (history.length === 0 && toYMD(new Date(p.created_at)) === today) return history;
  return [...history, { from_minor: p.amount_minor, to_minor: to, date: today }];
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
  /** income − bills − setAside − pots. Only meaningful when `hasIncome`. */
  leftToSpend: number;
  /** bills + setAside: everything spoken for, for users who don't track income. */
  committed: number;
  /** Some income falls in this period. */
  hasIncome: boolean;
  /** Any income is set up at all (even if none falls in this period). */
  anyIncome: boolean;
  /** Put into savings pots this period. */
  pots: number;
  /** Unexpected costs paid from pots (already saved, so not counted again). */
  fromPots: number;
};

export function summarisePeriod(
  payments: RecurringPayment[],
  transactions: Transaction[],
  period: Period,
  bufferMinor: number,
  potsMinor = 0
): PeriodSummary {
  const occ = occurrencesInRange(payments, transactions, period.start, period.end, payments);
  const sum = (list: Occurrence[]) => list.reduce((s, o) => s + occurrenceAmount(o), 0);
  const outs = occ.filter((o) => o.payment.direction === 'out');
  const allUnexpected = transactions.filter(
    (t) => t.kind === 'unexpected' && t.date >= period.start && t.date <= period.end
  );
  const unexpected = allUnexpected.filter((t) => !t.pot_id);
  const fromPots = allUnexpected.filter((t) => t.pot_id).reduce((s, t) => s + t.amount_minor, 0);
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
    leftToSpend: income - bills - setAside - potsMinor,
    committed: bills + setAside + potsMinor,
    hasIncome: occ.some((o) => o.payment.direction === 'in'),
    anyIncome: payments.some((p) => p.direction === 'in'),
    pots: potsMinor,
    fromPots,
  };
}

// ─── Pots ────────────────────────────────────────────────────────────────────

/** Saved so far: contributions and adjustments, minus unexpected costs paid from it. */
export function potBalance(pot: Pot, entries: PotEntry[], transactions: Transaction[]) {
  const put = entries.filter((e) => e.pot_id === pot.id).reduce((s, e) => s + e.amount_minor, 0);
  const spent = transactions.filter((t) => t.pot_id === pot.id).reduce((s, t) => s + t.amount_minor, 0);
  return put - spent;
}

/** Periods from `period` up to and including the one containing `date` (at least 1). */
export function periodsUntil(period: Period, date: string, startDay: number) {
  let n = 1;
  for (let p = period; p.end < date && n < 600; p = shiftPeriod(p, 1, startDay)) n++;
  return n;
}

/**
 * What to put in for `period`, given the pot's balance at that point. Never
 * negative, and never more than is left to reach a target.
 */
export function potAmountFor(pot: Pot, balance: number, period: Period, startDay: number): number {
  const remaining = pot.target_minor == null ? null : pot.target_minor - balance;
  if (remaining != null && remaining <= 0) return 0;
  if (!pot.auto || pot.target_minor == null || pot.target_date == null) {
    const fixed = Math.max(0, pot.monthly_minor);
    return remaining == null ? fixed : Math.min(fixed, remaining);
  }
  return Math.ceil(remaining! / periodsUntil(period, pot.target_date, startDay));
}

/** Longest gap filled in one go, so an app left closed for years can't add hundreds of rows. */
const MAX_CATCH_UP_PERIODS = 24;

/**
 * Contributions that should exist but don't yet: one per pot for each period
 * from the pot's first (the one it was created in) up to the current one.
 *
 * A period gets an entry even when nothing goes in (e.g. the target is
 * reached), so it's marked as done and never back-filled later. A recorded
 * contribution covers the month from its `period_start`, and any period that
 * starts inside that month is skipped, so changing the budget month's start
 * day can't put money in twice (at worst one period gets nothing, which
 * "work it out" pots make up the next period).
 */
export function pendingContributions(
  pots: Pot[],
  entries: PotEntry[],
  transactions: Transaction[],
  today: string,
  startDay: number
): Omit<PotEntry, 'id' | 'created_at'>[] {
  const current = periodFor(today, startDay);
  const result: Omit<PotEntry, 'id' | 'created_at'>[] = [];
  for (const pot of pots) {
    const contributions = entries.filter((e) => e.pot_id === pot.id && e.kind === 'contribution');
    const last = contributions.reduce<string | null>((m, e) => (m == null || e.period_start > m ? e.period_start : m), null);
    const coveredUntil = last ? addMonthsClamped(last, 1) : null; // exclusive
    let p = periodFor(last ?? toYMD(new Date(pot.created_at)), startDay);
    if (shiftPeriod(current, -MAX_CATCH_UP_PERIODS, startDay).start > p.start) {
      p = shiftPeriod(current, -MAX_CATCH_UP_PERIODS + 1, startDay);
    }
    let balance = potBalance(pot, entries, transactions);
    for (; p.start <= current.start; p = shiftPeriod(p, 1, startDay)) {
      if (coveredUntil && p.start < coveredUntil) continue;
      const amount = potAmountFor(pot, balance, p, startDay);
      result.push({ pot_id: pot.id, kind: 'contribution', amount_minor: amount, period_start: p.start });
      balance += amount;
    }
  }
  return result;
}

/**
 * What goes into `pot` in `period`. Past and current periods use what was
 * recorded. Future periods are projected one period at a time from now, so
 * each one accounts for the money planned before it.
 */
export function potAmountInPeriod(
  pot: Pot,
  entries: PotEntry[],
  transactions: Transaction[],
  period: Period,
  today: string,
  startDay: number
): number {
  const current = periodFor(today, startDay);
  if (period.start <= current.start) {
    return entries
      .filter(
        (e) =>
          e.pot_id === pot.id &&
          e.kind === 'contribution' &&
          e.period_start >= period.start &&
          e.period_start <= period.end
      )
      .reduce((s, e) => s + e.amount_minor, 0);
  }
  let balance = potBalance(pot, entries, transactions);
  let amount = 0;
  for (let p = shiftPeriod(current, 1, startDay); p.start <= period.start; p = shiftPeriod(p, 1, startDay)) {
    amount = potAmountFor(pot, balance, p, startDay);
    balance += amount;
  }
  return amount;
}

/** Total put into all pots in `period` (recorded for past/current, projected for future). */
export function potsTotalFor(
  pots: Pot[],
  entries: PotEntry[],
  transactions: Transaction[],
  period: Period,
  today: string,
  startDay: number
) {
  return pots.reduce((s, pot) => s + potAmountInPeriod(pot, entries, transactions, period, today, startDay), 0);
}

// ─── Settings ────────────────────────────────────────────────────────────────

export type FinanceSettings = {
  /** Day of the month a budget period starts on (1–28). 1 = calendar months. */
  periodStartDay: number;
  /** Money set aside each period for unexpected costs, in pence. 0 = no buffer. */
  bufferMinor: number;
  hideIncomeHint: boolean;
  /** Show bill due dates on the Planner calendar. */
  showBillsOnPlanner: boolean;
};

export const DEFAULT_SETTINGS: FinanceSettings = {
  periodStartDay: 1,
  bufferMinor: 0,
  hideIncomeHint: false,
  showBillsOnPlanner: false,
};

const SETTINGS_KEY = 'finance:settings';

/** Parses stored settings, falling back to defaults for anything missing, unreadable or out of range. */
function parseSettings(raw: string | null): FinanceSettings {
  let parsed: unknown = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    console.warn('Money settings were unreadable, using defaults.');
  }
  const s = { ...DEFAULT_SETTINGS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  if (!Number.isInteger(s.periodStartDay) || s.periodStartDay < 1 || s.periodStartDay > 28) s.periodStartDay = 1;
  if (!Number.isSafeInteger(s.bufferMinor) || s.bufferMinor < 0) s.bufferMinor = 0;
  s.hideIncomeHint = s.hideIncomeHint === true;
  s.showBillsOnPlanner = s.showBillsOnPlanner === true;
  return s;
}

/** For display: never throws, using defaults if storage can't be read. */
export async function loadFinanceSettings(): Promise<FinanceSettings> {
  try {
    return parseSettings(await AsyncStorage.getItem(SETTINGS_KEY));
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
  const [pots, setPots] = useState<Pot[]>([]);
  const [potEntries, setPotEntries] = useState<PotEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  /** The last load failed; the screen shows an error instead of looking empty. */
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [p, t, s, pots, storedEntries] = await Promise.all([
        selectRows<RecurringPayment>('finance_recurring', { orderBy: 'name' }),
        selectRows<Transaction>('finance_transactions', { orderBy: 'date', ascending: false }),
        loadFinanceSettings(),
        selectRows<Pot>('finance_pots', { orderBy: 'name' }),
        selectRows<PotEntry>('finance_pot_entries'),
      ]);
      let entries = storedEntries;
      // Put this period's (and any missed periods') money into each pot, in one write.
      const pending = pendingContributions(pots, entries, t, toYMD(new Date()), s.periodStartDay);
      if (pending.length > 0) {
        try {
          const added = await insertRowsUnless<PotEntry>(
            'finance_pot_entries',
            pending,
            // Another load may have added the same period in the meantime.
            (stored, e) => stored.pot_id === e.pot_id && stored.kind === 'contribution' && stored.period_start === e.period_start
          );
          entries = [...entries, ...added];
        } catch (err) {
          console.warn('Could not add pot contributions:', err);
        }
      }
      setPayments(p);
      setTransactions(t);
      setSettings(s);
      setPots(pots);
      setPotEntries(entries);
      setLoadError(false);
    } catch (e) {
      console.error('Failed to load money data:', e);
      setLoadError(true);
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

  /**
   * Saves edits. A changed amount is added to the bill's price history, and
   * unpausing skips the payments that fell while it was paused.
   */
  const updatePayment = useCallback(
    (id: string, input: RecurringInput) =>
      run(() =>
        updateRows(
          'finance_recurring',
          (r) => r.id === id,
          (r) => {
            const old = r as RecurringPayment;
            const today = todayYMD();
            const patch: Partial<RecurringPayment> = { ...input };
            if (old.paused && !input.paused) patch.skip_before = today;
            if (old.amount_minor !== input.amount_minor) {
              patch.price_history = recordPriceChange(old, input.amount_minor, today);
            }
            return patch;
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
            date: todayYMD(),
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
        // Merge with what's stored, not what's on screen, so two quick saves can't
        // undo each other. A failed read throws here (and the save is reported
        // as failed) rather than writing defaults over the user's settings.
        const next = { ...parseSettings(await AsyncStorage.getItem(SETTINGS_KEY)), ...patch };
        await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      }),
    [run]
  );

  const addPot = useCallback((input: PotInput) => run(() => insertRows<Pot>('finance_pots', [input])), [run]);

  const updatePot = useCallback(
    (id: string, input: PotInput) => run(() => updateRows('finance_pots', (r) => r.id === id, () => input)),
    [run]
  );

  /** Deletes the pot and its contributions. Costs paid from it stay, still marked as from a pot. */
  const deletePot = useCallback((id: string) => run(() => deleteRows('finance_pots', (r) => r.id === id)), [run]);

  /**
   * Records a correction so the pot's balance becomes `target` (e.g. to match
   * a real savings account). The current balance is read from storage, not
   * the screen, so money added since the form opened is taken into account.
   */
  const setPotBalance = useCallback(
    (pot: Pot, target: number) =>
      run(async () => {
        const [entries, transactions] = await Promise.all([
          selectRows<PotEntry>('finance_pot_entries'),
          selectRows<Transaction>('finance_transactions'),
        ]);
        const current = potBalance(pot, entries, transactions);
        if (target === current) return;
        await insertRows<PotEntry>('finance_pot_entries', [
          {
            pot_id: pot.id,
            kind: 'adjustment',
            amount_minor: target - current,
            period_start: periodFor(toYMD(new Date()), settings.periodStartDay).start,
          },
        ]);
      }),
    [run, settings.periodStartDay]
  );

  return {
    payments,
    transactions,
    settings,
    pots,
    potEntries,
    loaded,
    loadError,
    reload,
    addPot,
    updatePot,
    deletePot,
    setPotBalance,
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
