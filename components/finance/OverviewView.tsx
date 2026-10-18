import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import {
  FinanceSettings,
  isSettled,
  Occurrence,
  occurrencesInRange,
  periodFor,
  periodLabel,
  RecurringPayment,
  shiftPeriod,
  summarisePeriod,
  Transaction,
} from '../../utils/finance';
import { formatMoney } from '../../utils/money';
import { addDays, daysBetween } from '../../utils/recurrence';
import { OccurrenceRow } from './BillsView';

type Props = {
  payments: RecurringPayment[];
  transactions: Transaction[];
  settings: FinanceSettings;
  today: string;
  onEdit: (bill: RecurringPayment) => void;
  onTogglePaid: (occ: Occurrence) => void;
  onAddIncome: () => void;
  onDismissIncomeHint: () => void;
  onOpenSettings: () => void;
};

/** Buffer colour: teal while healthy, amber under 25% left, red once overspent. */
function bufferColor(left: number, buffer: number) {
  if (left < 0) return '#e11d48';
  if (left < buffer * 0.25) return '#f59e0b';
  return '#0d9488';
}

export default function OverviewView({
  payments,
  transactions,
  settings,
  today,
  onEdit,
  onTogglePaid,
  onAddIncome,
  onDismissIncomeHint,
  onOpenSettings,
}: Props) {
  const [offset, setOffset] = useState(0);
  const startDay = settings.periodStartDay;
  const period = shiftPeriod(periodFor(today, startDay), offset, startDay);
  const isCurrent = offset === 0;
  const s = summarisePeriod(payments, transactions, period, settings.bufferMinor);

  const daysLeft = isCurrent ? daysBetween(today, period.end) + 1 : 0;
  const perDay = s.hasIncome && isCurrent && s.leftToSpend > 0 ? s.leftToSpend / daysLeft : null;

  const comingUp = isCurrent
    ? occurrencesInRange(
        payments.filter((p) => p.direction === 'out'),
        transactions,
        today,
        addDays(today, 6)
      ).filter((o) => !isSettled(o))
    : [];

  const bufferLeft = s.buffer - s.unexpected;

  function row(label: string, value: string, note?: string, tone?: 'in' | 'out') {
    return (
      <View className="flex-row items-baseline justify-between py-1.5">
        <View className="flex-1 pr-2">
          <Text className="text-sm text-stone-700 dark:text-stone-200">{label}</Text>
          {note ? <Text className="text-[11px] text-stone-400 dark:text-stone-500">{note}</Text> : null}
        </View>
        <Text
          className={`text-sm font-semibold ${tone === 'in' ? 'text-green-700 dark:text-green-400' : 'text-stone-800 dark:text-stone-100'}`}
        >
          {value}
        </Text>
      </View>
    );
  }

  const headline = s.hasIncome ? s.leftToSpend : s.committed;

  return (
    <View className="px-4">
      {/* ── Period switcher ── */}
      <View className="flex-row items-center justify-between mb-3">
        <TouchableOpacity hitSlop={10} onPress={() => setOffset((o) => o - 1)} accessibilityLabel="Previous period">
          <Text className="text-2xl px-2 text-stone-500 dark:text-stone-400">‹</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setOffset(0)} disabled={isCurrent}>
          <Text className="text-base font-bold text-stone-800 dark:text-stone-100 text-center">
            {periodLabel(period, startDay)}
          </Text>
          {!isCurrent && <Text className="text-[11px] text-teal-600 text-center">Back to now</Text>}
        </TouchableOpacity>
        <TouchableOpacity hitSlop={10} onPress={() => setOffset((o) => o + 1)} accessibilityLabel="Next period">
          <Text className="text-2xl px-2 text-stone-500 dark:text-stone-400">›</Text>
        </TouchableOpacity>
      </View>

      {/* ── Headline + breakdown ── */}
      <View className="p-4 mb-3 bg-white dark:bg-stone-800 rounded-xl">
        <Text className="text-xs font-semibold text-stone-500 dark:text-stone-400">
          {s.hasIncome ? 'Left to spend' : 'Spent and set aside'}
        </Text>
        <View className="flex-row items-baseline justify-between">
          <Text
            className={`text-4xl font-bold ${s.hasIncome && headline < 0 ? 'text-rose-600' : 'text-stone-800 dark:text-stone-100'}`}
          >
            {formatMoney(headline)}
          </Text>
          {perDay != null && (
            <Text className="text-sm text-stone-500 dark:text-stone-400">≈ {formatMoney(perDay)}/day</Text>
          )}
        </View>
        {s.hasIncome && headline < 0 && (
          <Text className="text-xs text-rose-600 mt-0.5">More is going out than coming in this period.</Text>
        )}

        <View className="mt-3 pt-2 border-t border-stone-100 dark:border-stone-700">
          {s.hasIncome && row('Income', formatMoney(s.income), undefined, 'in')}
          {row(
            'Bills',
            `${s.hasIncome ? '−' : ''}${formatMoney(s.bills)}`,
            s.bills > 0 ? `${formatMoney(s.billsPaid)} paid · ${formatMoney(s.billsDue)} to pay` : undefined
          )}
          {row(
            s.buffer > 0 ? 'Set aside for surprises' : 'Unexpected',
            `${s.hasIncome ? '−' : ''}${formatMoney(s.setAside)}`,
            s.buffer > 0
              ? s.unexpected > s.buffer
                ? `Unexpected costs went ${formatMoney(s.unexpected - s.buffer)} over your buffer`
                : `${s.unexpectedCount} unexpected ${s.unexpectedCount === 1 ? 'cost' : 'costs'} so far`
              : `${s.unexpectedCount} this period`
          )}
        </View>
      </View>

      {/* ── Income hint ── */}
      {!s.hasIncome && !settings.hideIncomeHint && (
        <View className="flex-row items-center p-3 mb-3 rounded-xl bg-teal-50 dark:bg-teal-950">
          <TouchableOpacity className="flex-1 pr-2" onPress={onAddIncome}>
            <Text className="text-sm text-teal-800 dark:text-teal-200">
              Add your income to see what&apos;s left to spend.
            </Text>
            <Text className="text-xs font-bold text-teal-700 dark:text-teal-300 mt-0.5">+ Add income</Text>
          </TouchableOpacity>
          <TouchableOpacity hitSlop={10} onPress={onDismissIncomeHint} accessibilityLabel="Dismiss">
            <Text className="text-sm text-teal-700 dark:text-teal-300">✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Buffer ── */}
      {s.buffer > 0 ? (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={onOpenSettings}
          className="p-4 mb-3 bg-white dark:bg-stone-800 rounded-xl"
        >
          <View className="flex-row justify-between items-baseline mb-2">
            <Text className="text-sm font-semibold text-stone-700 dark:text-stone-200">Buffer for surprises</Text>
            <Text className="text-sm font-semibold" style={{ color: bufferColor(bufferLeft, s.buffer) }}>
              {bufferLeft >= 0
                ? `${formatMoney(bufferLeft)} of ${formatMoney(s.buffer)} left`
                : `${formatMoney(-bufferLeft)} over`}
            </Text>
          </View>
          <View className="h-2 rounded-full bg-stone-100 dark:bg-stone-700 overflow-hidden">
            <View
              className="h-2 rounded-full"
              style={{
                width: `${Math.max(0, Math.min(100, (bufferLeft / s.buffer) * 100))}%`,
                backgroundColor: bufferColor(bufferLeft, s.buffer),
              }}
            />
          </View>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity onPress={onOpenSettings} className="p-3 mb-3 rounded-xl border border-dashed border-stone-300 dark:border-stone-600">
          <Text className="text-sm text-stone-600 dark:text-stone-300">
            Set aside money each month for unexpected costs, like a car repair or vet bill.
          </Text>
          <Text className="text-xs font-bold text-teal-600 mt-0.5">Set up a buffer</Text>
        </TouchableOpacity>
      )}

      {/* ── Coming up ── */}
      {comingUp.length > 0 && (
        <View className="mb-2">
          <Text className="text-xs font-bold uppercase tracking-wide mb-2 text-stone-500 dark:text-stone-400">
            Coming up this week
          </Text>
          {comingUp.map((o) => (
            <OccurrenceRow
              key={`${o.payment.id}|${o.due}`}
              o={o}
              today={today}
              onEdit={onEdit}
              onTogglePaid={onTogglePaid}
            />
          ))}
        </View>
      )}
    </View>
  );
}
