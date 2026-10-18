import React, { useState } from 'react';
import { Text, TouchableOpacity, useColorScheme, View } from 'react-native';
import { buildMonthGrid, DAY_LABELS, fromYMD, toYMD } from '../../utils/dates';
import {
  categoryColor,
  isSettled,
  Occurrence,
  occurrenceAmount,
  occurrencesInRange,
  RecurringPayment,
  Transaction,
} from '../../utils/finance';
import { formatMoney } from '../../utils/money';
import { useTheme } from '../../utils/theme';
import { OccurrenceRow } from './OccurrenceRow';

type Props = {
  /** Bills only (money out). */
  bills: RecurringPayment[];
  /** Every stored payment, so ticks for deleted bills still show. */
  allPayments: RecurringPayment[];
  transactions: Transaction[];
  today: string;
  onEdit: (bill: RecurringPayment) => void;
  onTogglePaid: (occ: Occurrence) => void;
};

const MAX_DOTS = 3;

/** Month grid with a dot per bill on its due date; tap a day to list them. */
export default function BillsCalendar({ bills, allPayments, transactions, today, onEdit, onTogglePaid }: Props) {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const now = fromYMD(today);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selected, setSelected] = useState(today);

  const grid = buildMonthGrid(year, month);
  const occ = occurrencesInRange(bills, transactions, toYMD(grid[0]), toYMD(grid[grid.length - 1]), allPayments);
  const byDay = new Map<string, Occurrence[]>();
  for (const o of occ) byDay.set(o.due, [...(byDay.get(o.due) ?? []), o]);

  const inMonth = occ.filter((o) => fromYMD(o.due).getMonth() === month);
  const monthTotal = inMonth.reduce((s, o) => s + occurrenceAmount(o), 0);
  const selectedItems = byDay.get(selected) ?? [];

  function shiftMonth(n: number) {
    const d = new Date(year, month + n, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  function dotColor(o: Occurrence) {
    if (isSettled(o)) return isDark ? '#57534e' : '#d6d3d1';
    if (o.due < today) return '#e11d48';
    return categoryColor(o.payment.category);
  }

  const outsideMonthColor = isDark ? '#44403c' : '#d6d3d1';
  const todayBg = isDark ? '#134e4a' : '#ccfbf1';
  const todayText = isDark ? '#5eead4' : '#0d9488';

  return (
    <View>
      <View className="bg-white dark:bg-stone-800 rounded-xl pb-2 mb-3">
        {/* ── Month navigation ── */}
        <View className="flex-row items-center justify-between px-2 pt-2">
          <TouchableOpacity className="p-2" onPress={() => shiftMonth(-1)} accessibilityLabel="Previous month">
            <Text className="text-2xl text-teal-700 dark:text-teal-400 font-semibold">‹</Text>
          </TouchableOpacity>
          <View className="items-center">
            <Text className="text-base font-bold text-stone-800 dark:text-stone-100">
              {new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </Text>
            <Text className="text-[11px] text-stone-500 dark:text-stone-400">
              {formatMoney(monthTotal)} in bills
            </Text>
          </View>
          <TouchableOpacity className="p-2" onPress={() => shiftMonth(1)} accessibilityLabel="Next month">
            <Text className="text-2xl text-teal-700 dark:text-teal-400 font-semibold">›</Text>
          </TouchableOpacity>
        </View>

        {/* ── Day labels ── */}
        <View className="flex-row px-1 pb-1">
          {DAY_LABELS.map((label) => (
            <View key={label} className="flex-1 items-center">
              <Text className="text-[11px] font-semibold text-stone-400 dark:text-stone-500">{label}</Text>
            </View>
          ))}
        </View>

        {/* ── Grid ── */}
        {Array.from({ length: 6 }, (_, week) => (
          <View key={week} className="flex-row px-1">
            {grid.slice(week * 7, week * 7 + 7).map((day) => {
              const ymd = toYMD(day);
              const isCurrentMonth = day.getMonth() === month;
              const isToday = ymd === today;
              const isSelected = ymd === selected;
              const items = byDay.get(ymd) ?? [];
              return (
                <TouchableOpacity key={ymd} className="flex-1 items-center py-1" onPress={() => setSelected(ymd)}>
                  <View
                    className="w-[32px] h-[32px] rounded-full items-center justify-center"
                    style={
                      isSelected ? { backgroundColor: '#0d9488' } : isToday ? { backgroundColor: todayBg } : undefined
                    }
                  >
                    <Text
                      className="text-[14px] font-semibold"
                      style={{
                        color: isSelected
                          ? '#ffffff'
                          : isToday
                          ? todayText
                          : isCurrentMonth
                          ? theme.text
                          : outsideMonthColor,
                      }}
                    >
                      {day.getDate()}
                    </Text>
                  </View>
                  <View className="h-[5px] flex-row items-center justify-center mt-[1px]" style={{ gap: 2 }}>
                    {items.slice(0, MAX_DOTS).map((o) => (
                      <View
                        key={o.payment.id}
                        className="w-[5px] h-[5px] rounded-full"
                        style={{ backgroundColor: dotColor(o), opacity: isCurrentMonth ? 1 : 0.4 }}
                      />
                    ))}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      {/* ── Selected day ── */}
      <Text className="text-xs font-bold uppercase tracking-wide mb-2 text-stone-500 dark:text-stone-400">
        {fromYMD(selected).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
      </Text>
      {selectedItems.length === 0 ? (
        <Text className="text-sm text-stone-500 dark:text-stone-400 mb-3">No bills due.</Text>
      ) : (
        selectedItems.map((o) => (
          <OccurrenceRow
            key={`${o.payment.id}|${o.due}`}
            o={o}
            today={today}
            onEdit={onEdit}
            onTogglePaid={onTogglePaid}
          />
        ))
      )}
    </View>
  );
}
