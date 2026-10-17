import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { fromYMD } from '../../utils/dates';
import { Period, Pot, potAmountInPeriod, potBalance, PotEntry, Transaction } from '../../utils/finance';
import { formatMoney } from '../../utils/money';

type Props = {
  pots: Pot[];
  entries: PotEntry[];
  transactions: Transaction[];
  period: Period;
  periodStartDay: number;
  today: string;
  onOpen: (pot: Pot) => void;
  onAdd: () => void;
};

const BAR = '#0d9488';

/** Savings pots with how much is saved and what goes in each month. */
export default function PotsSection({ pots, entries, transactions, period, periodStartDay, today, onOpen, onAdd }: Props) {
  return (
    <View className="mb-3">
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-xs font-bold uppercase tracking-wide text-stone-500 dark:text-stone-400">Pots</Text>
        <TouchableOpacity hitSlop={8} onPress={onAdd}>
          <Text className="text-xs font-bold text-teal-600">+ New pot</Text>
        </TouchableOpacity>
      </View>

      {pots.length === 0 ? (
        <TouchableOpacity
          onPress={onAdd}
          className="p-3 rounded-xl border border-dashed border-stone-300 dark:border-stone-600"
        >
          <Text className="text-sm text-stone-600 dark:text-stone-300">
            Save a bit each month for costs you know are coming, like car insurance £540 by March or Christmas £400
            by December.
          </Text>
          <Text className="text-xs font-bold text-teal-600 mt-0.5">Create a pot</Text>
        </TouchableOpacity>
      ) : (
        pots.map((pot) => {
          const balance = potBalance(pot, entries, transactions);
          const monthly = potAmountInPeriod(pot, entries, transactions, period, today, periodStartDay);
          const reached = pot.target_minor != null && balance >= pot.target_minor;
          const pct = pot.target_minor ? Math.max(0, Math.min(100, (balance / pot.target_minor) * 100)) : null;
          const by = pot.target_date
            ? fromYMD(pot.target_date).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
            : null;
          const note = reached
            ? 'Target reached'
            : [monthly > 0 ? `${formatMoney(monthly)}/month` : null, by ? `by ${by}` : null].filter(Boolean).join(' · ');
          return (
            <TouchableOpacity
              key={pot.id}
              activeOpacity={0.7}
              onPress={() => onOpen(pot)}
              className="p-3 mb-2 bg-white dark:bg-stone-800 rounded-xl"
              accessibilityLabel={`${pot.name}: ${formatMoney(balance)} saved${pot.target_minor ? ` of ${formatMoney(pot.target_minor)}` : ''}`}
            >
              <View className="flex-row justify-between items-baseline">
                <Text numberOfLines={1} className="flex-1 pr-2 text-sm font-semibold text-stone-800 dark:text-stone-100">
                  {pot.name}
                </Text>
                <Text className="text-sm font-semibold text-stone-800 dark:text-stone-100">
                  {formatMoney(balance)}
                  {pot.target_minor != null && (
                    <Text className="font-normal text-stone-500 dark:text-stone-400"> of {formatMoney(pot.target_minor)}</Text>
                  )}
                </Text>
              </View>
              {pct != null && (
                <View className="h-1.5 rounded-full bg-stone-100 dark:bg-stone-700 overflow-hidden mt-2">
                  <View className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: BAR }} />
                </View>
              )}
              {note ? (
                <Text className={`text-[11px] mt-1 ${reached ? 'text-teal-700 dark:text-teal-300 font-semibold' : 'text-stone-500 dark:text-stone-400'}`}>
                  {reached ? '✓ ' : ''}
                  {note}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })
      )}
    </View>
  );
}
