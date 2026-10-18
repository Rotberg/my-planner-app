import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { formatDay } from '../../utils/dates';
import { categoryColor, isSettled, Occurrence, occurrenceAmount, RecurringPayment } from '../../utils/finance';
import { formatMoney } from '../../utils/money';

/** One bill occurrence with a tick to mark it paid. Shared by the Overview, Bills list and calendar. */
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
  const note = o.deleted
    ? 'Bill deleted'
    : o.detached
    ? o.payment.paused
      ? 'Bill paused'
      : 'Old schedule'
    : o.assumed
    ? 'Already paid'
    : null;
  const meta = [overdue ? 'Overdue' : null, formatDay(o.due), o.payment.category, note].filter(Boolean).join(' · ');
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      // A deleted bill has nothing left to edit.
      onPress={o.deleted ? undefined : () => onEdit(o.payment)}
      disabled={o.deleted}
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
