import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { formatDay, fromYMD, todayYMD, toYMD } from '../../utils/dates';
import {
  CATEGORIES,
  DEFAULT_REMINDER_DAYS,
  Frequency,
  FREQUENCY_OPTIONS,
  INCOME_CATEGORIES,
  isSettled,
  nextDueOnOrAfter,
  endAfterPayments,
  occurrencesInRange,
  overdueStart,
  RecurringInput,
  RecurringPayment,
  REMINDER_OPTIONS,
  Transaction,
} from '../../utils/finance';
import { formatMoney, minorToInput, parseMoney } from '../../utils/money';
import { addDays } from '../../utils/recurrence';
import { useTheme } from '../../utils/theme';
import Chip from './Chip';

type Props = {
  visible: boolean;
  /** Payment being edited, or null to add a new one. */
  bill: RecurringPayment | null;
  /** Whether a new payment starts as a bill or as income. */
  defaultDirection?: 'out' | 'in';
  /** Used to warn before a schedule change hides unpaid overdue payments. */
  transactions: Transaction[];
  onSubmit: (input: RecurringInput) => void;
  onDelete?: () => void;
  onClose: () => void;
};

type EndMode = 'never' | 'date' | 'count';

/** Add/edit sheet for a repeating payment. */
export default function BillForm({ visible, bill, defaultDirection = 'out', transactions, onSubmit, onDelete, onClose }: Props) {
  const theme = useTheme();

  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<Frequency>('monthly');
  /** Shown date: first payment for a new bill, next due date when editing. */
  const [date, setDate] = useState(todayYMD());
  const [initialDate, setInitialDate] = useState(todayYMD());
  const [endMode, setEndMode] = useState<EndMode>('never');
  const [endDate, setEndDate] = useState(todayYMD());
  const [count, setCount] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0].name);
  const [paused, setPaused] = useState(false);
  const [remindDays, setRemindDays] = useState<number | null>(DEFAULT_REMINDER_DAYS);
  const [alreadyPaid, setAlreadyPaid] = useState(true);
  const [notes, setNotes] = useState('');
  const [picker, setPicker] = useState<null | 'date' | 'end'>(null);
  const scrollRef = useRef<ScrollView>(null);
  const notesFocused = useRef(false);

  // Reset the form every time it opens.
  useEffect(() => {
    if (!visible) return;
    const today = todayYMD();
    const shown = bill ? nextDueOnOrAfter(bill, today) ?? bill.anchor_date : today;
    setDirection(bill?.direction ?? defaultDirection);
    setName(bill?.name ?? '');
    setAmount(bill ? minorToInput(bill.amount_minor) : '');
    setFrequency(bill?.frequency ?? 'monthly');
    setDate(shown);
    setInitialDate(shown);
    setEndMode(bill?.end_date ? 'date' : 'never');
    setEndDate(bill?.end_date ?? shown);
    setCount('');
    setCategory(bill?.category ?? (defaultDirection === 'in' ? INCOME_CATEGORIES : CATEGORIES)[0].name);
    setPaused(bill?.paused ?? false);
    // Bills saved before reminders existed have no setting: treat as off.
    setRemindDays(bill ? bill.remind_days_before ?? null : DEFAULT_REMINDER_DAYS);
    setAlreadyPaid(true);
    setNotes(bill?.notes ?? '');
    setPicker(null);
  }, [visible, bill, defaultDirection]);

  // Notes sits at the bottom of the sheet, so once the keyboard has finished
  // opening, scroll it back into view above the keyboard.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      if (notesFocused.current) scrollRef.current?.scrollToEnd({ animated: true });
    });
    return () => sub.remove();
  }, []);

  function submit() {
    if (!name.trim()) {
      Alert.alert('Missing name', isIncome ? 'Where is this money from?' : 'What is this payment for?');
      return;
    }
    const amountMinor = parseMoney(amount);
    if (amountMinor == null || amountMinor === 0) {
      Alert.alert('Invalid amount', 'Enter an amount like 12 or 12.99.');
      return;
    }
    // Keep the original start unless the schedule changed, so past
    // occurrences (and their paid ticks) still line up.
    const rescheduled = !bill || date !== initialDate || frequency !== bill.frequency;
    const anchor = rescheduled ? date : bill!.anchor_date;
    let end: string | null = null;
    if (endMode === 'date') {
      if (endDate < date) {
        Alert.alert('Invalid end date', 'The last payment date must be on or after the next payment.');
        return;
      }
      end = endDate;
    } else if (endMode === 'count') {
      const n = Number(count);
      if (!Number.isInteger(n) || n < 1) {
        Alert.alert('Invalid number of payments', 'Enter how many payments are left, e.g. 12.');
        return;
      }
      // Count along the real schedule from the date shown (the next payment),
      // so month-end bills (e.g. the 31st) aren't cut short by a shorter month.
      end = endAfterPayments({ anchor_date: anchor, frequency }, date, n);
    }
    const input: RecurringInput = {
      name: name.trim(),
      amount_minor: amountMinor,
      direction,
      frequency,
      anchor_date: anchor,
      end_date: end,
      category,
      paused,
      remind_days_before: direction === 'out' ? remindDays : null,
      notes: notes.trim() || undefined,
    };
    // Only set when the schedule (re)starts, so existing bills keep their setting.
    if (rescheduled) input.paid_before = date < todayYMD() && alreadyPaid ? todayYMD() : null;

    // Restarting the schedule drops the old one's unpaid overdue payments.
    const today = todayYMD();
    const lost =
      bill && rescheduled
        ? occurrencesInRange([bill], transactions, overdueStart(today), addDays(today, -1)).filter(
            (o) => !isSettled(o) && !o.detached
          )
        : [];
    if (lost.length > 0) {
      Alert.alert(
        'Unpaid payments will be removed',
        `Changing the date or how often it repeats starts a new schedule. ${lost.length} unpaid overdue ${
          lost.length === 1 ? 'payment' : 'payments'
        } (${lost.map((o) => formatDay(o.due)).join(', ')}) will no longer show. Tick them off first if you've paid them.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Change anyway', style: 'destructive', onPress: () => onSubmit(input) },
        ]
      );
      return;
    }
    onSubmit(input);
  }

  function confirmDelete() {
    Alert.alert(isIncome ? 'Delete income' : 'Delete bill', 'Payments you have already ticked off are kept in your history.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);
  }

  const isIncome = direction === 'in';
  const categories = isIncome ? INCOME_CATEGORIES : CATEGORIES;
  const noun = isIncome ? 'Income' : 'Bill';

  function changeDirection(next: 'out' | 'in') {
    setDirection(next);
    const list = next === 'in' ? INCOME_CATEGORIES : CATEGORIES;
    if (!list.some((c) => c.name === category)) setCategory(list[0].name);
  }

  const inputClass =
    'border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 dark:text-stone-100';
  const fieldClass = 'border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5';
  const labelClass = 'text-xs font-semibold text-stone-500 dark:text-stone-400 mb-1.5';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      {/* Android is edge-to-edge, so the window no longer resizes for the
          keyboard; pad on both platforms to keep the sheet above it. */}
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable className="flex-1 justify-end" style={{ backgroundColor: theme.modalBackdrop }} onPress={onClose}>
          <Pressable className="bg-white dark:bg-stone-800 rounded-t-[20px]" style={{ maxHeight: '90%' }} onPress={() => {}}>
            <ScrollView
              ref={scrollRef}
              contentContainerStyle={{ padding: 20, paddingBottom: 36 }}
              keyboardShouldPersistTaps="handled"
            >
              {/* Header */}
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-xl font-bold text-stone-800 dark:text-stone-100">
                  {bill ? `Edit ${noun}` : `New ${noun}`}
                </Text>
                <TouchableOpacity onPress={onClose} hitSlop={10}>
                  <Text className="text-sm font-semibold text-stone-500 dark:text-stone-400">Cancel</Text>
                </TouchableOpacity>
              </View>

              {/* Money out / in */}
              <View className="flex-row mb-3" style={{ gap: 6 }}>
                {([
                  ['out', 'Bill (money out)'],
                  ['in', 'Income (money in)'],
                ] as const).map(([value, label]) => (
                  <View key={value} className="flex-1">
                    <Chip
                      label={label}
                      selected={direction === value}
                      color={value === 'in' ? '#16a34a' : '#0d9488'}
                      onPress={() => changeDirection(value)}
                    />
                  </View>
                ))}
              </View>

              {/* Name + amount */}
              <TextInput
                className={`${inputClass} mb-3`}
                placeholder={isIncome ? 'e.g. Salary, Child benefit' : 'e.g. Rent, Netflix, Council tax'}
                placeholderTextColor={theme.placeholder}
                value={name}
                onChangeText={setName}
                autoFocus={!bill}
                returnKeyType="next"
              />
              <Text className={labelClass}>Amount</Text>
              <View className={`flex-row items-center ${fieldClass} mb-3`} style={{ paddingVertical: 0 }}>
                <Text className="text-[15px] text-stone-500 dark:text-stone-400 mr-1">£</Text>
                <TextInput
                  className="flex-1 py-2.5 text-[15px] text-stone-800 dark:text-stone-100"
                  placeholder="0.00"
                  placeholderTextColor={theme.placeholder}
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                />
              </View>

              {/* Frequency */}
              <Text className={labelClass}>How often</Text>
              <View className="flex-row flex-wrap mb-3" style={{ gap: 6 }}>
                {FREQUENCY_OPTIONS.map((opt) => (
                  <Chip
                    key={opt.value}
                    label={opt.label}
                    selected={frequency === opt.value}
                    onPress={() => setFrequency(opt.value)}
                  />
                ))}
              </View>

              {/* Date */}
              <Text className={labelClass}>{bill ? 'Next payment' : 'First payment'}</Text>
              <TouchableOpacity className={`${fieldClass} mb-3`} onPress={() => setPicker('date')}>
                <Text className="text-sm text-stone-600 dark:text-stone-300">{formatDay(date, true)}</Text>
              </TouchableOpacity>
              {picker === 'date' && (
                <DateTimePicker
                  value={fromYMD(date)}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'inline' : 'default'}
                  onChange={(event, selected) => {
                    if (Platform.OS !== 'ios') setPicker(null);
                    // Android reports the original value on Cancel; only accept a real pick.
                    if (event.type !== 'set' || !selected) return;
                    setDate(toYMD(selected));
                  }}
                />
              )}

              {/* Past start date: were the earlier payments made? */}
              {date < todayYMD() && (!bill || date !== initialDate || frequency !== bill.frequency) && (
                <View
                  className="flex-row items-center justify-between rounded-lg px-3 py-2 mb-3"
                  style={{ borderWidth: 1, borderColor: theme.border }}
                >
                  <View className="flex-1 pr-3">
                    <Text className="text-sm font-semibold" style={{ color: theme.text }}>
                      Payments before today are already paid
                    </Text>
                    <Text className="text-[11px]" style={{ color: theme.placeholder }}>
                      {alreadyPaid
                        ? 'Earlier payments count as paid, e.g. rent you’ve paid for years.'
                        : 'Earlier payments show as overdue until you tick them off.'}
                    </Text>
                  </View>
                  <Switch
                    value={alreadyPaid}
                    onValueChange={setAlreadyPaid}
                    trackColor={{ true: '#14b8a6', false: theme.border }}
                    thumbColor="#ffffff"
                  />
                </View>
              )}

              {/* Ends */}
              <Text className={labelClass}>Ends</Text>
              <View className="flex-row mb-3" style={{ gap: 6 }}>
                {([
                  ['never', 'Never'],
                  ['date', 'On a date'],
                  ['count', 'After N payments'],
                ] as const).map(([value, label]) => (
                  <View key={value} className="flex-1">
                    <Chip label={label} selected={endMode === value} onPress={() => setEndMode(value)} />
                  </View>
                ))}
              </View>
              {endMode === 'date' && (
                <>
                  <TouchableOpacity className={`${fieldClass} mb-3`} onPress={() => setPicker('end')}>
                    <Text className="text-sm text-stone-600 dark:text-stone-300">Last payment: {formatDay(endDate, true)}</Text>
                  </TouchableOpacity>
                  {picker === 'end' && (
                    <DateTimePicker
                      value={fromYMD(endDate)}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'inline' : 'default'}
                      onChange={(event, selected) => {
                        if (Platform.OS !== 'ios') setPicker(null);
                        if (event.type !== 'set' || !selected) return;
                        setEndDate(toYMD(selected));
                      }}
                    />
                  )}
                </>
              )}
              {endMode === 'count' && (
                <TextInput
                  className={`${inputClass} mb-3`}
                  placeholder="Payments left, including the next one"
                  placeholderTextColor={theme.placeholder}
                  value={count}
                  onChangeText={setCount}
                  keyboardType="number-pad"
                  returnKeyType="done"
                />
              )}

              {/* Category */}
              <Text className={labelClass}>Category</Text>
              <View className="flex-row flex-wrap mb-3" style={{ gap: 6 }}>
                {categories.map((c) => (
                  <Chip
                    key={c.name}
                    label={c.name}
                    color={c.color}
                    selected={category === c.name}
                    onPress={() => setCategory(c.name)}
                  />
                ))}
              </View>

              {/* Reminder (bills only) */}
              {!isIncome && (
                <>
                  <Text className={labelClass}>Remind me</Text>
                  <View className="flex-row flex-wrap mb-3" style={{ gap: 6 }}>
                    {REMINDER_OPTIONS.map((opt) => (
                      <Chip
                        key={opt.label}
                        label={opt.label}
                        selected={remindDays === opt.value}
                        onPress={() => setRemindDays(opt.value)}
                      />
                    ))}
                  </View>
                </>
              )}

              {/* Price history (editing only) */}
              {bill?.price_history && bill.price_history.length > 0 && (
                <>
                  <Text className={labelClass}>Price changes</Text>
                  <View className="rounded-lg px-3 py-2 mb-3" style={{ borderWidth: 1, borderColor: theme.border }}>
                    {[...bill.price_history].reverse().map((c, i) => {
                      const up = c.to_minor > c.from_minor;
                      // A rise is bad news for a bill but good news for income.
                      const bad = up === !isIncome;
                      return (
                        <View key={`${c.date}-${i}`} className="flex-row justify-between py-1">
                          <Text className="text-xs text-stone-500 dark:text-stone-400">
                            {fromYMD(c.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                          </Text>
                          <Text className="text-xs text-stone-700 dark:text-stone-200">
                            {formatMoney(c.from_minor)} → {formatMoney(c.to_minor)}{' '}
                            <Text style={{ color: bad ? '#e11d48' : '#16a34a' }}>
                              ({up ? '+' : '−'}
                              {formatMoney(Math.abs(c.to_minor - c.from_minor))})
                            </Text>
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </>
              )}

              {/* Pause (editing only) */}
              {bill && (
                <View
                  className="flex-row items-center justify-between rounded-lg px-3 py-2 mb-3"
                  style={{ borderWidth: 1, borderColor: theme.border }}
                >
                  <View className="flex-1 pr-3">
                    <Text className="text-sm font-semibold" style={{ color: theme.text }}>Paused</Text>
                    <Text className="text-[11px]" style={{ color: theme.placeholder }}>
                      Left out of upcoming payments and totals until you unpause it
                    </Text>
                  </View>
                  <Switch
                    value={paused}
                    onValueChange={setPaused}
                    trackColor={{ true: '#14b8a6', false: theme.border }}
                    thumbColor="#ffffff"
                  />
                </View>
              )}

              {/* Notes */}
              <Text className={labelClass}>Notes</Text>
              <TextInput
                className={`${inputClass} mb-4 h-20`}
                placeholder="Optional…"
                placeholderTextColor={theme.placeholder}
                value={notes}
                onChangeText={setNotes}
                onFocus={() => {
                  notesFocused.current = true;
                  // Keyboard may already be open from another field, in which
                  // case keyboardDidShow won't fire again.
                  setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
                }}
                onBlur={() => {
                  notesFocused.current = false;
                }}
                multiline
                textAlignVertical="top"
              />

              <TouchableOpacity className="bg-teal-600 rounded-lg py-3 items-center" onPress={submit}>
                <Text className="text-white text-[15px] font-bold">{bill ? 'Save Changes' : `Add ${noun}`}</Text>
              </TouchableOpacity>

              {bill && onDelete ? (
                <TouchableOpacity className="mt-3 py-2.5 items-center" onPress={confirmDelete}>
                  <Text className="text-rose-600 text-sm font-semibold">Delete {noun}</Text>
                </TouchableOpacity>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
