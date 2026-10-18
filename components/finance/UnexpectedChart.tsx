import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { fromYMD } from '../../utils/dates';
import { Period, periodLabel, shiftPeriod, Transaction } from '../../utils/finance';
import { formatMoney } from '../../utils/money';

type Props = {
  transactions: Transaction[];
  /** The current period; the chart ends here. */
  period: Period;
  periodStartDay: number;
};

const PERIODS = 6;
const PLOT_HEIGHT = 96;
// Passes the palette validator against both the light and dark card surfaces.
const BAR = '#0d9488';

/**
 * Unexpected spend per period for the last six periods, one bar each.
 * Values are labelled on the current and highest bars only; tap any bar to
 * read its exact total.
 */
export default function UnexpectedChart({ transactions, period, periodStartDay }: Props) {
  const periods = Array.from({ length: PERIODS }, (_, i) => shiftPeriod(period, i - (PERIODS - 1), periodStartDay));
  const data = periods.map((p) => {
    const items = transactions.filter((t) => t.kind === 'unexpected' && t.date >= p.start && t.date <= p.end);
    return { period: p, total: items.reduce((s, t) => s + t.amount_minor, 0), count: items.length };
  });
  const max = Math.max(...data.map((d) => d.total));
  const maxIndex = data.findIndex((d) => d.total === max);
  const [selected, setSelected] = useState(PERIODS - 1);
  const sel = data[selected];
  const average = data.reduce((s, d) => s + d.total, 0) / PERIODS;

  return (
    <View className="p-3 mb-3 bg-white dark:bg-stone-800 rounded-xl">
      <Text className="text-xs font-semibold text-stone-500 dark:text-stone-400">Unexpected costs, last 6 months</Text>
      <Text className="text-sm text-stone-800 dark:text-stone-100 mb-2">
        <Text className="font-bold">{periodLabel(sel.period, periodStartDay)}</Text>: {formatMoney(sel.total)}
        <Text className="text-stone-500 dark:text-stone-400">
          {' '}
          · {sel.count} {sel.count === 1 ? 'cost' : 'costs'}
        </Text>
      </Text>

      <View className="flex-row items-end" style={{ height: PLOT_HEIGHT + 16, gap: 2 }}>
        {data.map((d, i) => {
          const h = max > 0 ? Math.max(d.total > 0 ? 3 : 0, (d.total / max) * PLOT_HEIGHT) : 0;
          const showValue = d.total > 0 && (i === PERIODS - 1 || i === maxIndex);
          return (
            <Pressable
              key={d.period.start}
              className="flex-1 items-center justify-end"
              style={{ height: PLOT_HEIGHT + 16 }}
              onPress={() => setSelected(i)}
              accessibilityRole="button"
              accessibilityLabel={`${periodLabel(d.period, periodStartDay)}: ${formatMoney(d.total)}, ${d.count} costs`}
            >
              {showValue && (
                <Text className="text-[10px] text-stone-500 dark:text-stone-400 mb-0.5" numberOfLines={1}>
                  {formatMoney(d.total).replace(/\.00$/, '')}
                </Text>
              )}
              <View
                style={{
                  width: '55%',
                  height: h,
                  backgroundColor: BAR,
                  opacity: i === selected ? 1 : 0.55,
                  borderTopLeftRadius: 4,
                  borderTopRightRadius: 4,
                }}
              />
            </Pressable>
          );
        })}
      </View>
      {/* Baseline */}
      <View className="h-px bg-stone-200 dark:bg-stone-700" />
      <View className="flex-row mt-1" style={{ gap: 2 }}>
        {data.map((d, i) => (
          <Text
            key={d.period.start}
            className={`flex-1 text-center text-[10px] ${i === selected ? 'font-bold text-stone-700 dark:text-stone-200' : 'text-stone-400 dark:text-stone-500'}`}
          >
            {fromYMD(d.period.start).toLocaleDateString(undefined, { month: 'short' })}
          </Text>
        ))}
      </View>
      <Text className="text-[11px] text-stone-400 dark:text-stone-500 mt-2">
        Average {formatMoney(average)} a month. Tap a bar to see its total.
      </Text>
    </View>
  );
}
