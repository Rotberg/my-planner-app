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
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { fromYMD, todayYMD, toYMD } from '../../utils/dates';
import { Pot, Transaction, UNEXPECTED_CATEGORIES, UnexpectedInput } from '../../utils/finance';
import { minorToInput, parseMoney } from '../../utils/money';
import { useTheme } from '../../utils/theme';
import Chip from './Chip';

type Props = {
  visible: boolean;
  /** Entry being edited, or null to add a new one. */
  entry: Transaction | null;
  /** Pre-filled values for a new entry (from the quick-add bar). */
  draft?: { name: string; amount: string };
  pots: Pot[];
  onSubmit: (input: UnexpectedInput) => void;
  onDelete?: () => void;
  onClose: () => void;
};

/** Add/edit sheet for an unexpected cost. */
export default function UnexpectedForm({ visible, entry, draft, pots, onSubmit, onDelete, onClose }: Props) {
  const theme = useTheme();

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayYMD());
  const [category, setCategory] = useState('Other');
  const [notes, setNotes] = useState('');
  const [potId, setPotId] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const notesFocused = useRef(false);

  // Reset the form every time it opens.
  useEffect(() => {
    if (!visible) return;
    setName(entry?.name ?? draft?.name ?? '');
    setAmount(entry ? minorToInput(entry.amount_minor) : draft?.amount ?? '');
    setDate(entry?.date ?? todayYMD());
    setCategory(entry?.category ?? 'Other');
    setNotes(entry?.notes ?? '');
    setPotId(entry?.pot_id ?? null);
    setShowPicker(false);
  }, [visible, entry, draft]);

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
      Alert.alert('Missing description', 'What was this for?');
      return;
    }
    const amountMinor = parseMoney(amount);
    if (amountMinor == null || amountMinor === 0) {
      Alert.alert('Invalid amount', 'Enter an amount like 12 or 12.99.');
      return;
    }
    onSubmit({
      name: name.trim(),
      amount_minor: amountMinor,
      date,
      category,
      notes: notes.trim() || undefined,
      // A pot deleted since this was saved still counts as "from a pot".
      pot_id: potId,
    });
  }

  function confirmDelete() {
    Alert.alert('Delete cost', `Delete “${entry?.name}”?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);
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
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-xl font-bold text-stone-800 dark:text-stone-100">
                  {entry ? 'Edit Unexpected Cost' : 'Unexpected Cost'}
                </Text>
                <TouchableOpacity onPress={onClose} hitSlop={10}>
                  <Text className="text-sm font-semibold text-stone-500 dark:text-stone-400">Cancel</Text>
                </TouchableOpacity>
              </View>

              <TextInput
                className={`${inputClass} mb-3`}
                placeholder="e.g. Car repair, Vet bill"
                placeholderTextColor={theme.placeholder}
                value={name}
                onChangeText={setName}
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

              <Text className={labelClass}>Date</Text>
              <TouchableOpacity className={`${fieldClass} mb-3`} onPress={() => setShowPicker(true)}>
                <Text className="text-sm text-stone-600 dark:text-stone-300">
                  {fromYMD(date).toLocaleDateString(undefined, {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </Text>
              </TouchableOpacity>
              {showPicker && (
                <DateTimePicker
                  value={fromYMD(date)}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'inline' : 'default'}
                  onChange={(event, selected) => {
                    if (Platform.OS !== 'ios') setShowPicker(false);
                    // Android reports the original value on Cancel; only accept a real pick.
                    if (event.type !== 'set' || !selected) return;
                    setDate(toYMD(selected));
                  }}
                />
              )}

              <Text className={labelClass}>Category</Text>
              <View className="flex-row flex-wrap mb-3" style={{ gap: 6 }}>
                {UNEXPECTED_CATEGORIES.map((c) => (
                  <Chip
                    key={c.name}
                    label={c.name}
                    color={c.color}
                    selected={category === c.name}
                    onPress={() => setCategory(c.name)}
                  />
                ))}
              </View>

              {(pots.length > 0 || potId) && (
                <>
                  <Text className={labelClass}>Paid from</Text>
                  <View className="flex-row flex-wrap mb-1" style={{ gap: 6 }}>
                    {[{ id: null, name: 'Buffer / everyday money' }, ...pots].map((p) => (
                      <Chip key={p.id ?? 'buffer'} label={p.name} selected={potId === p.id} onPress={() => setPotId(p.id)} />
                    ))}
                  </View>
                  <Text className="text-[11px] text-stone-400 dark:text-stone-500 mb-3">
                    Costs paid from a pot come out of what you saved, not this month&apos;s money.
                  </Text>
                </>
              )}

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
                <Text className="text-white text-[15px] font-bold">{entry ? 'Save Changes' : 'Add Cost'}</Text>
              </TouchableOpacity>

              {entry && onDelete ? (
                <TouchableOpacity className="mt-3 py-2.5 items-center" onPress={confirmDelete}>
                  <Text className="text-rose-600 text-sm font-semibold">Delete Cost</Text>
                </TouchableOpacity>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
