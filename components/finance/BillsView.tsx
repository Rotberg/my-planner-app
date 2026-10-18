import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { fromYMD } from '../../utils/dates';
import {
  categoryColor,
  FREQUENCY_OPTIONS,
  isActive,
  isSettled,
  monthlyEquivalent,
  nextDueOnOrAfter,
  Occurrence,
  occurrenceAmount,
  occurrencesInRange,
  overdueStart,
  Period,
  RecurringPayment,
  shiftPeriod,
  Transaction,
} from '../../utils/finance';
import { formatMoney } from '../../utils/money';
import { addDays } from '../../utils/recurrence';

type Props = {
  payments: RecurringPayment[];
  transactions: Transaction[];
  today: string;
  /** The budget period containing today. */
  period: Period;
  periodStartDay: number;
  onEdit: (bill: RecurringPayment) => void;
  onTogglePaid: (occ: Occurrence) => void;
};

export function shortDate(ymd: string) {
  return fromYMD(ymd).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

const frequencyLabel = (f: RecurringPayment['frequency']) => FREQUENCY_OPTIONS.find((o) => o.value === f)?.label ?? f;

/** One bill occurrence with a tick to mark it paid. Shared with the Overview. */
export function OccurrenceRow({
  o,
  today,
  onEdit,
  onTogglePaid,
}: {
  o: Occurrence;
  today: string;
  onEdit: (bill: RecurringPayment) => void;
  onTogglePaid: (occ: Occurrence) => void;
}) {
  const settled = isSettled(o);
  const overdue = !settled && o.due < today;
  const meta = [overdue ? 'Overdue' : null, shortDate(o.due), o.payment.category, o.assumed ? 'Before you added it' : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => onEdit(o.payment)}
      className="flex-row items-center bg-white dark:bg-stone-800 rounded-[10px] mb-2 overflow-hidden"
      style={{ borderLeftWidth: 4, borderLeftColor: overdue ? '#e11d48' : categoryColor(o.payment.category) }}
    >
      <TouchableOpacity
        className="pl-3 pr-2.5 py-3"
        onPress={() => onTogglePaid(o)}
        // Assumed-paid dates have no record to remove, so they can't be unticked.
        disabled={o.assumed}
        hitSlop={6}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: settled, disabled: o.assumed }}
        accessibilityLabel={`Mark ${o.payment.name} as paid`}
      >
        <View
          className="w-[22px] h-[22px] rounded-full border-2 border-teal-600 items-center justify-center"
          style={o.assumed ? { opacity: 0.4 } : undefined}
        >
          {settled && <View className="w-[12px] h-[12px] rounded-full bg-teal-600" />}
        </View>
      </TouchableOpacity>
      <View className="flex-1 py-2.5 pr-2">
        <Text
          numberOfLines={1}
          className={`text-[15px] font-medium ${settled ? 'line-through text-stone-400 dark:text-stone-500' : 'text-stone-800 dark:text-stone-100'}`}
        >
          {o.payment.name}
        </Text>
        <Text className={`text-xs ${overdue ? 'text-rose-600' : 'text-stone-500 dark:text-stone-400'}`}>{meta}</Text>
      </View>
      <Text
        className={`pr-3 text-[15px] font-semibold ${settled ? 'text-stone-400 dark:text-stone-500' : 'text-stone-800 dark:text-stone-100'}`}
      >
        {formatMoney(occurrenceAmount(o))}
      </Text>
    </TouchableOpacity>
  );
}

/** Upcoming bills grouped by when they're due, plus the lists of all bills and income. */
export default function BillsView({ payments, transactions, today, period, periodStartDay, onEdit, onTogglePaid }: Props) {
  const nextPeriod = shiftPeriod(period, 1, periodStartDay);
  const weekEnd = addDays(today, 6);
  const calendar = periodStartDay === 1;

  const out = payments.filter((p) => p.direction === 'out');
  const income = payments.filter((p) => p.direction === 'in');
  const active = out.filter((p) => isActive(p, today));
  const perMonth = active.reduce((sum, p) => sum + monthlyEquivalent(p.amount_minor, p.frequency), 0);

  const all = occurrencesInRange(out, transactions, overdueStart(today), nextPeriod.end);
  const overdue = all.filter((o) => o.due < today && !isSettled(o));
  const paidEarlier = all.filter((o) => o.due >= period.start && o.due < today && isSettled(o));
  const thisWeek = all.filter((o) => o.due >= today && o.due <= weekEnd);
  const laterThisPeriod = all.filter((o) => o.due > weekEnd && o.due <= period.end);
  const nextOnes = all.filter((o) => o.due > weekEnd && o.due > period.end);

  const inPeriod = all.filter((o) => o.due >= period.start && o.due <= period.end);
  const paidTotal = inPeriod.filter(isSettled).reduce((s, o) => s + occurrenceAmount(o), 0);
  const dueTotal = inPeriod.filter((o) => !isSettled(o)).reduce((s, o) => s + occurrenceAmount(o), 0);
  const monthName = fromYMD(today).toLocaleDateString(undefined, { month: 'long' });
  const thisLabel = calendar ? monthName : 'this pay period';

  function section(title: string, items: Occurrence[], danger = false) {
    if (items.length === 0) return null;
    return (
      <View className="mb-2">
        <Text
          className={`text-xs font-bold uppercase tracking-wide mb-2 ${danger ? 'text-rose-600' : 'text-stone-500 dark:text-stone-400'}`}
        >
          {title}
        </Text>
        {items.map((o) => (
          <OccurrenceRow
            key={`${o.payment.id}|${o.due}`}
            o={o}
            today={today}
            onEdit={onEdit}
            onTogglePaid={onTogglePaid}
          />
        ))}
      </View>
    );
  }

  function paymentRow(p: RecurringPayment) {
    const next = isActive(p, today) ? nextDueOnOrAfter(p, today) : null;
    const status = p.paused ? 'Paused' : next ? `Next ${shortDate(next)}` : 'Ended';
    return (
      <TouchableOpacity
        key={p.id}
        activeOpacity={0.7}
        onPress={() => onEdit(p)}
        className="flex-row items-center bg-white dark:bg-stone-800 rounded-[10px] mb-2 px-3 py-2.5"
        style={{ opacity: p.paused || !next ? 0.6 : 1 }}
      >
        <View className="w-2.5 h-2.5 rounded-full mr-3" style={{ backgroundColor: categoryColor(p.category) }} />
        <View className="flex-1 pr-2">
          <Text numberOfLines={1} className="text-[15px] font-medium text-stone-800 dark:text-stone-100">
            {p.name}
          </Text>
          <Text className="text-xs text-stone-500 dark:text-stone-400">
            {frequencyLabel(p.frequency)} · {status}
          </Text>
        </View>
        <View className="items-end">
          <Text
            className={`text-[15px] font-semibold ${p.direction === 'in' ? 'text-green-700 dark:text-green-400' : 'text-stone-800 dark:text-stone-100'}`}
          >
            {p.direction === 'in' ? '+' : ''}
            {formatMoney(p.amount_minor)}
          </Text>
          {p.frequency !== 'monthly' && (
            <Text className="text-[11px] text-stone-400 dark:text-stone-500">
              ≈ {formatMoney(monthlyEquivalent(p.amount_minor, p.frequency))}/mo
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  if (payments.length === 0) {
    return (
      <View className="mx-4 mt-2 p-5 bg-white dark:bg-stone-800 rounded-xl items-center">
        <Text className="text-base font-bold text-stone-800 dark:text-stone-100 mb-1">No bills yet</Text>
        <Text className="text-sm text-center text-stone-500 dark:text-stone-400">
          Add the payments that come out regularly, like rent, council tax, your phone contract or Netflix.
          You&apos;ll see what&apos;s due next and what they cost each month.
        </Text>
      </View>
    );
  }

  return (
    <View className="px-4">
      {/* ── Totals ── */}
      {out.length > 0 && (
        <View className="p-4 mb-4 bg-white dark:bg-stone-800 rounded-xl">
          <Text className="text-xs font-semibold text-stone-500 dark:text-stone-400">Bills per month</Text>
          <Text className="text-3xl font-bold text-stone-800 dark:text-stone-100">{formatMoney(perMonth)}</Text>
          <Text className="text-xs text-stone-500 dark:text-stone-400 mb-3">
            {formatMoney(perMonth * 12)} a year · {active.length} active {active.length === 1 ? 'bill' : 'bills'}
          </Text>
          <View className="flex-row" style={{ gap: 8 }}>
            <View className="flex-1 rounded-lg px-3 py-2 bg-teal-50 dark:bg-teal-950">
              <Text className="text-[11px] text-teal-700 dark:text-teal-300">
                Paid {calendar ? `in ${monthName}` : 'this period'}
              </Text>
              <Text className="text-base font-bold text-teal-700 dark:text-teal-300">{formatMoney(paidTotal)}</Text>
            </View>
            <View className="flex-1 rounded-lg px-3 py-2 bg-stone-100 dark:bg-stone-700">
              <Text className="text-[11px] text-stone-500 dark:text-stone-300">Still to pay</Text>
              <Text className="text-base font-bold text-stone-800 dark:text-stone-100">{formatMoney(dueTotal)}</Text>
            </View>
          </View>
        </View>
      )}

      {/* ── Upcoming ── */}
      {section('Overdue', overdue, true)}
      {section('Due in the next 7 days', thisWeek)}
      {section(`Later ${calendar ? `in ${monthName}` : thisLabel}`, laterThisPeriod)}
      {section(calendar ? 'Next month' : 'Next pay period', nextOnes)}
      {section(`Paid earlier ${calendar ? `in ${monthName}` : thisLabel}`, paidEarlier)}

      {/* ── All bills / income ── */}
      {out.length > 0 && (
        <>
          <Text className="text-xs font-bold uppercase tracking-wide mt-2 mb-2 text-stone-500 dark:text-stone-400">
            All bills
          </Text>
          {out.map(paymentRow)}
        </>
      )}
      {income.length > 0 && (
        <>
          <Text className="text-xs font-bold uppercase tracking-wide mt-2 mb-2 text-stone-500 dark:text-stone-400">
            Income
          </Text>
          {income.map(paymentRow)}
        </>
      )}
    </View>
  );
}
