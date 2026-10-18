import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { fromYMD, todayYMD, toYMD } from '../../utils/dates';
import { Period, Pot, PotInput, potAmountFor, shiftPeriod } from '../../utils/finance';
import { formatMoney, minorToInput, parseMoney } from '../../utils/money';
import { addMonthsClamped } from '../../utils/recurrence';
import { useTheme } from '../../utils/theme';
import Chip from './Chip';

type Props = {
  visible: boolean;
  /** Pot being edited, or null to add a new one. */
  pot: Pot | null;
  /** Current balance of the pot being edited. */
  balance: number;
  period: Period;
  periodStartDay: number;
  onSubmit: (input: PotInput, newBalance: number | null) => void;
  onDelete?: () => void;
  onClose: () => void;
};

/** Add/edit sheet for a savings pot. */
export default function PotForm({ visible, pot, balance, period, periodStartDay, onSubmit, onDelete, onClose }: Props) {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [hasDate, setHasDate] = useState(true);
  const [date, setDate] = useState(addMonthsClamped(todayYMD(), 6));
  const [auto, setAuto] = useState(true);
  const [monthly, setMonthly] = useState('');
  const [saved, setSaved] = useState('');
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(pot?.name ?? '');
    setTarget(pot?.target_minor != null ? minorToInput(pot.target_minor) : '');
    setHasDate(pot ? pot.target_date != null : true);
    setDate(pot?.target_date ?? addMonthsClamped(todayYMD(), 6));
    setAuto(pot?.auto ?? true);
    setMonthly(pot && pot.monthly_minor > 0 ? minorToInput(pot.monthly_minor) : '');
    setSaved(pot ? minorToInput(balance) : '');
    setShowPicker(false);
  }, [visible, pot, balance]);

  const targetMinor = target.trim() === '' ? null : parseMoney(target);
  const canAuto = targetMinor != null && targetMinor > 0 && hasDate;
  const preview =
    canAuto && auto
      ? potAmountFor(
          { auto: true, target_minor: targetMinor, target_date: date, monthly_minor: 0 } as Pot,
          pot ? balance : 0,
          // A new pot's first money goes in this period. An existing pot has
          // already had this period's, so preview the next one.
          pot ? shiftPeriod(period, 1, periodStartDay) : period,
          periodStartDay
        )
      : null;

  function submit() {
    if (!name.trim()) {
      Alert.alert('Missing name', 'What are you saving for?');
      return;
    }
    if (target.trim() !== '' && (targetMinor == null || targetMinor === 0)) {
      Alert.alert('Invalid target', 'Enter a target like 540, or leave it empty.');
      return;
    }
    const useAuto = auto && canAuto;
    let monthlyMinor = 0;
    if (!useAuto) {
      const m = parseMoney(monthly);
      if (m == null || m === 0) {
        Alert.alert(
          'How much each month?',
          canAuto
            ? 'Enter a monthly amount, or choose "Work it out".'
            : 'Enter a monthly amount. "Work it out" needs a target and a date.'
        );
        return;
      }
      monthlyMinor = m;
    }
    let newBalance: number | null = null;
    if (pot) {
      const b = parseMoney(saved);
      if (b == null) {
        Alert.alert('Invalid amount saved', 'Enter how much is in the pot, like 120 or 0.');
        return;
      }
      newBalance = b;
    }
    onSubmit(
      {
        name: name.trim(),
        target_minor: targetMinor,
        target_date: hasDate ? date : null,
        auto: useAuto,
        monthly_minor: monthlyMinor,
      },
      newBalance
    );
  }

  function confirmDelete() {
    Alert.alert('Delete pot', `Delete “${pot?.name}”? Costs you paid from it stay in your history.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);
  }

  const inputClass =
    'border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5 text-[15px] text-stone-800 dark:text-stone-100';
  const fieldClass = 'border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2.5';
  const labelClass = 'text-xs font-semibold text-stone-500 dark:text-stone-400 mb-1.5';
  const hintClass = 'text-[11px] text-stone-400 dark:text-stone-500 mb-3';

  function MoneyInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
    return (
      <View className={`flex-row items-center ${fieldClass} mb-1`} style={{ paddingVertical: 0 }}>
        <Text className="text-[15px] text-stone-500 dark:text-stone-400 mr-1">£</Text>
        <TextInput
          className="flex-1 py-2.5 text-[15px] text-stone-800 dark:text-stone-100"
          placeholder={placeholder}
          placeholderTextColor={theme.placeholder}
          value={value}
          onChangeText={onChange}
          keyboardType="decimal-pad"
        />
      </View>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable className="flex-1 justify-end" style={{ backgroundColor: theme.modalBackdrop }} onPress={onClose}>
          <Pressable className="bg-white dark:bg-stone-800 rounded-t-[20px]" style={{ maxHeight: '90%' }} onPress={() => {}}>
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 36 }} keyboardShouldPersistTaps="handled">
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-xl font-bold text-stone-800 dark:text-stone-100">{pot ? 'Edit Pot' : 'New Pot'}</Text>
                <TouchableOpacity onPress={onClose} hitSlop={10}>
                  <Text className="text-sm font-semibold text-stone-500 dark:text-stone-400">Cancel</Text>
                </TouchableOpacity>
              </View>

              <TextInput
                className={`${inputClass} mb-3`}
                placeholder="e.g. Car insurance, Christmas, MOT"
                placeholderTextColor={theme.placeholder}
                value={name}
                onChangeText={setName}
                autoFocus={!pot}
              />

              <Text className={labelClass}>Target (optional)</Text>
              {/* Called as functions, not <MoneyInput />, so the input isn't remounted (and unfocused) on each keystroke. */}
              {MoneyInput({ value: target, onChange: setTarget, placeholder: 'e.g. 540' })}
              <Text className={hintClass}>Leave empty for an open-ended pot, like car maintenance.</Text>

              <Text className={labelClass}>Needed by</Text>
              <View className="flex-row mb-2" style={{ gap: 6 }}>
                <Chip fill label="A date" selected={hasDate} onPress={() => setHasDate(true)} />
                <Chip fill label="No date" selected={!hasDate} onPress={() => setHasDate(false)} />
              </View>
              {hasDate && (
                <TouchableOpacity className={`${fieldClass} mb-3`} onPress={() => setShowPicker(true)}>
                  <Text className="text-sm text-stone-600 dark:text-stone-300">
                    {fromYMD(date).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
                  </Text>
                </TouchableOpacity>
              )}
              {hasDate && showPicker && (
                <DateTimePicker
                  value={fromYMD(date)}
                  mode="date"
                  minimumDate={new Date()}
                  display={Platform.OS === 'ios' ? 'inline' : 'default'}
                  onChange={(event, selected) => {
                    if (Platform.OS !== 'ios') setShowPicker(false);
                    if (event.type !== 'set' || !selected) return;
                    setDate(toYMD(selected));
                  }}
                />
              )}

              <Text className={`${labelClass} mt-1`}>Each month</Text>
              <View className="flex-row mb-2" style={{ gap: 6 }}>
                <Chip fill label="Work it out" selected={auto && canAuto} disabled={!canAuto} onPress={() => setAuto(true)} />
                <Chip fill label="Fixed amount" selected={!auto || !canAuto} onPress={() => setAuto(false)} />
              </View>
              {auto && canAuto ? (
                <Text className={hintClass}>
                  {preview && preview > 0
                    ? `About ${formatMoney(preview)} a month. It's recalculated each month, so it adjusts if you take money out.`
                    : 'Already reached: nothing more to put in.'}
                </Text>
              ) : (
                <>
                  {MoneyInput({ value: monthly, onChange: setMonthly, placeholder: 'e.g. 50' })}
                  <View className="mb-3" />
                </>
              )}

              {pot && (
                <>
                  <Text className={labelClass}>Saved so far</Text>
                  {MoneyInput({ value: saved, onChange: setSaved, placeholder: '0.00' })}
                  <Text className={hintClass}>Change this to match what you&apos;ve really put aside.</Text>
                </>
              )}

              <TouchableOpacity className="bg-teal-600 rounded-lg py-3 items-center mt-1" onPress={submit}>
                <Text className="text-white text-[15px] font-bold">{pot ? 'Save Changes' : 'Add Pot'}</Text>
              </TouchableOpacity>
              {pot && onDelete ? (
                <TouchableOpacity className="mt-3 py-2.5 items-center" onPress={confirmDelete}>
                  <Text className="text-rose-600 text-sm font-semibold">Delete Pot</Text>
                </TouchableOpacity>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
