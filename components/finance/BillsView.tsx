import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { fromYMD } from '../../utils/dates';
import {
  categoryColor,
  FREQUENCY_OPTIONS,
  isActive,
  monthlyEquivalent,
  nextDueOnOrAfter,
  Occurrence,
  occurrencesInRange,
  overdueStart,
  RecurringPayment,
  Transaction,
} from '../../utils/finance';
import { formatMoney } from '../../utils/money';
import { addDays, addMonthsClamped, monthBounds } from '../../utils/recurrence';

type Props = {
  payments: RecurringPayment[];
  transactions: Transaction[];
  today: string;
  onEdit: (bill: RecurringPayment) => void;
  onTogglePaid: (occ: Occurrence) => void;
};

function shortDate(ymd: string) {
  return fromYMD(ymd).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

const frequencyLabel = (f: RecurringPayment['frequency']) => FREQUENCY_OPTIONS.find((o) => o.value === f)?.label ?? f;

/** Upcoming bills grouped by when they're due, plus the list of all bills. */
export default function BillsView({ payments, transactions, today, onEdit, onTogglePaid }: Props) {
  const month = monthBounds(today);
  const nextMonthEnd = monthBounds(addMonthsClamped(month.start, 1)).end;
  const weekEnd = addDays(today, 6);

  const out = payments.filter((p) => p.direction === 'out');
  const active = out.filter((p) => isActive(p, today));
  const perMonth = active.reduce((sum, p) => sum + monthlyEquivalent(p.amount_minor, p.frequency), 0);

  const all = occurrencesInRange(out, transactions, overdueStart(today), nextMonthEnd);
  const overdue = all.filter((o) => o.due < today && !o.paid);
  const paidThisMonth = all.filter((o) => o.due >= month.start && o.due < today && o.paid);
  const thisWeek = all.filter((o) => o.due >= today && o.due <= weekEnd);
  const laterThisMonth = all.filter((o) => o.due > weekEnd && o.due <= month.end);
  const nextMonth = all.filter((o) => o.due > weekEnd && o.due > month.end);

  const thisMonth = all.filter((o) => o.due >= month.start && o.due <= month.end);
  const paidTotal = thisMonth.filter((o) => o.paid).reduce((s, o) => s + o.paid!.amount_minor, 0);
  const dueTotal = thisMonth.filter((o) => !o.paid).reduce((s, o) => s + o.payment.amount_minor, 0);
  const monthName = fromYMD(today).toLocaleDateString(undefined, { month: 'long' });

  function renderOccurrence(o: Occurrence, isOverdue = false) {
    const paid = !!o.paid;
    return (
      <TouchableOpacity
        key={`${o.payment.id}|${o.due}`}
        activeOpacity={0.7}
        onPress={() => onEdit(o.payment)}
        className="flex-row items-center bg-white dark:bg-stone-800 rounded-[10px] mb-2 overflow-hidden"
        style={{ borderLeftWidth: 4, borderLeftColor: isOverdue ? '#e11d48' : categoryColor(o.payment.category) }}
      >
        <TouchableOpacity
          className="pl-3 pr-2.5 py-3"
          onPress={() => onTogglePaid(o)}
          hitSlop={6}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: paid }}
          accessibilityLabel={`Mark ${o.payment.name} as paid`}
        >
          <View className="w-[22px] h-[22px] rounded-full border-2 border-teal-600 items-center justify-center">
            {paid && <View className="w-[12px] h-[12px] rounded-full bg-teal-600" />}
          </View>
        </TouchableOpacity>
        <View className="flex-1 py-2.5 pr-2">
          <Text
            numberOfLines={1}
            className={`text-[15px] font-medium ${paid ? 'line-through text-stone-400 dark:text-stone-500' : 'text-stone-800 dark:text-stone-100'}`}
          >
            {o.payment.name}
          </Text>
          <Text className={`text-xs ${isOverdue ? 'text-rose-600' : 'text-stone-500 dark:text-stone-400'}`}>
            {isOverdue ? 'Overdue · ' : ''}
            {shortDate(o.due)} · {o.payment.category}
          </Text>
        </View>
        <Text
          className={`pr-3 text-[15px] font-semibold ${paid ? 'text-stone-400 dark:text-stone-500' : 'text-stone-800 dark:text-stone-100'}`}
        >
          {formatMoney(o.paid?.amount_minor ?? o.payment.amount_minor)}
        </Text>
      </TouchableOpacity>
    );
  }

  function section(title: string, items: Occurrence[], isOverdue = false) {
    if (items.length === 0) return null;
    return (
      <View className="mb-2">
        <Text
          className={`text-xs font-bold uppercase tracking-wide mb-2 ${isOverdue ? 'text-rose-600' : 'text-stone-500 dark:text-stone-400'}`}
        >
          {title}
        </Text>
        {items.map((o) => renderOccurrence(o, isOverdue))}
      </View>
    );
  }

  if (out.length === 0) {
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
      <View className="p-4 mb-4 bg-white dark:bg-stone-800 rounded-xl">
        <Text className="text-xs font-semibold text-stone-500 dark:text-stone-400">Bills per month</Text>
        <Text className="text-3xl font-bold text-stone-800 dark:text-stone-100">{formatMoney(perMonth)}</Text>
        <Text className="text-xs text-stone-500 dark:text-stone-400 mb-3">
          {formatMoney(perMonth * 12)} a year · {active.length} active {active.length === 1 ? 'bill' : 'bills'}
        </Text>
        <View className="flex-row" style={{ gap: 8 }}>
          <View className="flex-1 rounded-lg px-3 py-2 bg-teal-50 dark:bg-teal-950">
            <Text className="text-[11px] text-teal-700 dark:text-teal-300">Paid in {monthName}</Text>
            <Text className="text-base font-bold text-teal-700 dark:text-teal-300">{formatMoney(paidTotal)}</Text>
          </View>
          <View className="flex-1 rounded-lg px-3 py-2 bg-stone-100 dark:bg-stone-700">
            <Text className="text-[11px] text-stone-500 dark:text-stone-300">Still to pay</Text>
            <Text className="text-base font-bold text-stone-800 dark:text-stone-100">{formatMoney(dueTotal)}</Text>
          </View>
        </View>
      </View>

      {/* ── Upcoming ── */}
      {section('Overdue', overdue, true)}
      {section('Due in the next 7 days', thisWeek)}
      {section(`Later in ${monthName}`, laterThisMonth)}
      {section('Next month', nextMonth)}
      {section(`Paid earlier in ${monthName}`, paidThisMonth)}

      {/* ── All bills ── */}
      <Text className="text-xs font-bold uppercase tracking-wide mt-2 mb-2 text-stone-500 dark:text-stone-400">
        All bills
      </Text>
      {out.map((p) => {
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
              <Text className="text-[15px] font-semibold text-stone-800 dark:text-stone-100">
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
      })}
    </View>
  );
}
