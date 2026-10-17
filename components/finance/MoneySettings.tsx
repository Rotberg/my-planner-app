import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { FinanceSettings } from '../../utils/finance';
import { minorToInput, parseMoney } from '../../utils/money';
import { useTheme } from '../../utils/theme';

type Props = {
  visible: boolean;
  settings: FinanceSettings;
  onSave: (patch: Partial<FinanceSettings>) => void;
  onClose: () => void;
};

function ordinal(n: number) {
  const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

/** Budget month start day and the buffer for unexpected costs. */
export default function MoneySettings({ visible, settings, onSave, onClose }: Props) {
  const theme = useTheme();
  const [payday, setPayday] = useState(false);
  const [day, setDay] = useState('');
  const [buffer, setBuffer] = useState('');
  const [onPlanner, setOnPlanner] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setPayday(settings.periodStartDay !== 1);
    setDay(settings.periodStartDay !== 1 ? String(settings.periodStartDay) : '');
    setBuffer(settings.bufferMinor > 0 ? minorToInput(settings.bufferMinor) : '');
    setOnPlanner(settings.showBillsOnPlanner);
  }, [visible, settings]);

  function save() {
    let periodStartDay = 1;
    if (payday) {
      const n = Number(day);
      if (!Number.isInteger(n) || n < 1 || n > 28) {
        Alert.alert('Invalid day', 'Enter a day from 1 to 28. If you are paid on the 29th–31st, use 28.');
        return;
      }
      periodStartDay = n;
    }
    const bufferMinor = buffer.trim() === '' ? 0 : parseMoney(buffer);
    if (bufferMinor == null) {
      Alert.alert('Invalid amount', 'Enter an amount like 100 or 100.00, or leave it empty for no buffer.');
      return;
    }
    onSave({ periodStartDay, bufferMinor, showBillsOnPlanner: onPlanner });
  }

  const labelClass = 'text-xs font-semibold text-stone-500 dark:text-stone-400 mb-1.5';
  const hintClass = 'text-[11px] text-stone-400 dark:text-stone-500 mb-2';
  const dayNum = Number(day);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable className="flex-1 justify-end" style={{ backgroundColor: theme.modalBackdrop }} onPress={onClose}>
          <Pressable className="bg-white dark:bg-stone-800 rounded-t-[20px]" style={{ maxHeight: '90%' }} onPress={() => {}}>
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 36 }} keyboardShouldPersistTaps="handled">
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-xl font-bold text-stone-800 dark:text-stone-100">Money Settings</Text>
                <TouchableOpacity onPress={onClose} hitSlop={10}>
                  <Text className="text-sm font-semibold text-stone-500 dark:text-stone-400">Cancel</Text>
                </TouchableOpacity>
              </View>

              {/* Budget month */}
              <Text className={labelClass}>My budget month runs</Text>
              <View className="flex-row mb-2" style={{ gap: 6 }}>
                {([
                  [false, 'Calendar month'],
                  [true, 'Payday to payday'],
                ] as const).map(([value, label]) => {
                  const selected = payday === value;
                  return (
                    <Pressable
                      key={label}
                      className="flex-1 py-2 rounded-lg border-[1.5px] items-center"
                      style={selected ? { backgroundColor: '#0d9488', borderColor: '#0d9488' } : { borderColor: theme.border }}
                      onPress={() => setPayday(value)}
                    >
                      <Text className={`text-[12px] font-semibold ${selected ? 'text-white' : 'text-stone-500 dark:text-stone-400'}`}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {payday ? (
                <>
                  <View className="flex-row items-center mb-1" style={{ gap: 8 }}>
                    <Text className="text-sm text-stone-700 dark:text-stone-200">I&apos;m paid on day</Text>
                    <TextInput
                      className="border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2 text-[15px] text-stone-800 dark:text-stone-100"
                      style={{ width: 64 }}
                      placeholder="25"
                      placeholderTextColor={theme.placeholder}
                      value={day}
                      onChangeText={setDay}
                      keyboardType="number-pad"
                      maxLength={2}
                    />
                    <Text className="text-sm text-stone-700 dark:text-stone-200">of the month</Text>
                  </View>
                  <Text className={hintClass}>
                    {Number.isInteger(dayNum) && dayNum >= 2 && dayNum <= 28
                      ? `Each period runs from the ${ordinal(dayNum)} to the ${ordinal(dayNum - 1)} of the next month.`
                      : 'Use 1–28. If you are paid on the 29th–31st, use 28.'}
                  </Text>
                </>
              ) : (
                <Text className={hintClass}>Totals run from the 1st to the end of each month.</Text>
              )}

              {/* Buffer */}
              <Text className={`${labelClass} mt-3`}>Buffer for unexpected costs</Text>
              <Text className={hintClass}>
                How much to set aside each period for surprises like a car repair or vet bill. Unexpected costs come out
                of this first. Leave empty for no buffer.
              </Text>
              <View
                className="flex-row items-center border border-stone-200 dark:border-stone-700 rounded-lg px-3 mb-5"
              >
                <Text className="text-[15px] text-stone-500 dark:text-stone-400 mr-1">£</Text>
                <TextInput
                  className="flex-1 py-2.5 text-[15px] text-stone-800 dark:text-stone-100"
                  placeholder="e.g. 100"
                  placeholderTextColor={theme.placeholder}
                  value={buffer}
                  onChangeText={setBuffer}
                  keyboardType="decimal-pad"
                />
              </View>

              {/* Planner */}
              <View
                className="flex-row items-center justify-between rounded-lg px-3 py-2 mb-5"
                style={{ borderWidth: 1, borderColor: theme.border }}
              >
                <View className="flex-1 pr-3">
                  <Text className="text-sm font-semibold" style={{ color: theme.text }}>
                    Show bills on the Planner
                  </Text>
                  <Text className="text-[11px]" style={{ color: theme.placeholder }}>
                    Adds a Bills filter to the Planner calendar
                  </Text>
                </View>
                <Switch
                  value={onPlanner}
                  onValueChange={setOnPlanner}
                  trackColor={{ true: '#14b8a6', false: theme.border }}
                  thumbColor="#ffffff"
                />
              </View>

              <TouchableOpacity className="bg-teal-600 rounded-lg py-3 items-center" onPress={save}>
                <Text className="text-white text-[15px] font-bold">Save</Text>
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
