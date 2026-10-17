import React, { useState } from 'react';
import { Alert, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { categoryColor, Period, Pot, Transaction, UnexpectedInput } from '../../utils/finance';
import { formatMoney, parseMoney } from '../../utils/money';
import { useTheme } from '../../utils/theme';
import { shortDate } from './OccurrenceRow';
import UnexpectedChart from './UnexpectedChart';

type Props = {
  transactions: Transaction[];
  period: Period;
  periodName: string;
  bufferMinor: number;
  pots: Pot[];
  periodStartDay: number;
  today: string;
  onQuickAdd: (input: UnexpectedInput) => Promise<boolean>;
  onMoreDetails: (draft: { name: string; amount: string }) => void;
  onEdit: (entry: Transaction) => void;
};

/** Older entries shown below this period's, newest first. */
const EARLIER_LIMIT = 30;

export default function UnexpectedView({
  transactions,
  period,
  periodName,
  bufferMinor,
  pots,
  periodStartDay,
  today,
  onQuickAdd,
  onMoreDetails,
  onEdit,
}: Props) {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');

  const unexpected = transactions
    .filter((t) => t.kind === 'unexpected')
    .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
  const current = unexpected.filter((t) => t.date >= period.start && t.date <= period.end);
  const earlier = unexpected.filter((t) => t.date < period.start).slice(0, EARLIER_LIMIT);
  const total = current.reduce((s, t) => s + t.amount_minor, 0);
  // Costs paid from a pot don't use up the buffer.
  const fromBuffer = current.filter((t) => !t.pot_id).reduce((s, t) => s + t.amount_minor, 0);
  const potName = (id: string) => pots.find((p) => p.id === id)?.name ?? 'a pot';

  async function quickAdd() {
    const amountMinor = parseMoney(amount);
    if (amountMinor == null || amountMinor === 0) {
      Alert.alert('Invalid amount', 'Enter an amount like 12 or 12.99.');
      return;
    }
    if (!name.trim()) {
      Alert.alert('Missing description', 'What was this for?');
      return;
    }
    const ok = await onQuickAdd({ name: name.trim(), amount_minor: amountMinor, date: today, category: 'Other' });
    if (ok) {
      setName('');
      setAmount('');
    }
  }

  function entryRow(t: Transaction) {
    return (
      <TouchableOpacity
        key={t.id}
        activeOpacity={0.7}
        onPress={() => onEdit(t)}
        className="flex-row items-center bg-white dark:bg-stone-800 rounded-[10px] mb-2 px-3 py-2.5"
      >
        <View className="w-2.5 h-2.5 rounded-full mr-3" style={{ backgroundColor: categoryColor(t.category) }} />
        <View className="flex-1 pr-2">
          <Text numberOfLines={1} className="text-[15px] font-medium text-stone-800 dark:text-stone-100">
            {t.name}
          </Text>
          <Text className="text-xs text-stone-500 dark:text-stone-400">
            {shortDate(t.date)} · {t.category}
            {t.pot_id ? ` · from ${potName(t.pot_id)}` : ''}
          </Text>
        </View>
        <Text className="text-[15px] font-semibold text-stone-800 dark:text-stone-100">
          {formatMoney(t.amount_minor)}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <View className="px-4">
      {/* ── Quick add ── */}
      <View className="p-3 mb-3 bg-white dark:bg-stone-800 rounded-xl">
        <Text className="text-xs font-semibold text-stone-500 dark:text-stone-400 mb-2">Log an unexpected cost</Text>
        <View className="flex-row mb-2" style={{ gap: 8 }}>
          <View
            className="flex-row items-center border border-stone-200 dark:border-stone-700 rounded-lg px-2.5"
            style={{ width: 110 }}
          >
            <Text className="text-[15px] text-stone-500 dark:text-stone-400 mr-1">£</Text>
            <TextInput
              className="flex-1 py-2.5 text-[15px] text-stone-800 dark:text-stone-100"
              placeholder="0.00"
              placeholderTextColor={theme.placeholder}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
            />
          </View>
          <TextInput
            className="flex-1 border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 dark:text-stone-100"
            placeholder="What was it?"
            placeholderTextColor={theme.placeholder}
            value={name}
            onChangeText={setName}
            returnKeyType="done"
            onSubmitEditing={quickAdd}
          />
        </View>
        <View className="flex-row items-center justify-between">
          <TouchableOpacity
            hitSlop={8}
            onPress={() => {
              onMoreDetails({ name, amount });
              setName('');
              setAmount('');
            }}
          >
            <Text className="text-xs font-semibold text-teal-600">More details…</Text>
          </TouchableOpacity>
          <TouchableOpacity className="bg-teal-600 rounded-lg px-4 py-2" onPress={quickAdd}>
            <Text className="text-white text-sm font-bold">Add</Text>
          </TouchableOpacity>
        </View>
      </View>

      <UnexpectedChart transactions={transactions} period={period} periodStartDay={periodStartDay} />

      {/* ── This period ── */}
      <View className="flex-row items-baseline justify-between mb-2">
        <Text className="text-xs font-bold uppercase tracking-wide text-stone-500 dark:text-stone-400">
          {periodName}
        </Text>
        <Text className="text-sm font-semibold text-stone-700 dark:text-stone-200">
          {formatMoney(total)}
        </Text>
      </View>
      {bufferMinor > 0 && (
        <Text className="text-xs text-stone-500 dark:text-stone-400 -mt-1 mb-2">
          {formatMoney(fromBuffer)} of your {formatMoney(bufferMinor)} buffer used
          {total > fromBuffer ? ` · ${formatMoney(total - fromBuffer)} from pots` : ''}
        </Text>
      )}
      {current.length === 0 ? (
        <Text className="text-sm text-stone-500 dark:text-stone-400 mb-3">
          Nothing unexpected yet. Log car repairs, vet bills and other surprises here.
        </Text>
      ) : (
        current.map(entryRow)
      )}

      {/* ── Earlier ── */}
      {earlier.length > 0 && (
        <>
          <Text className="text-xs font-bold uppercase tracking-wide mt-3 mb-2 text-stone-500 dark:text-stone-400">
            Earlier
          </Text>
          {earlier.map(entryRow)}
        </>
      )}
    </View>
  );
}
