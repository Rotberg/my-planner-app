import React, { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BillForm from '../components/finance/BillForm';
import BillsView from '../components/finance/BillsView';
import { todayYMD } from '../utils/dates';
import { Occurrence, RecurringInput, RecurringPayment, useFinance } from '../utils/finance';
import { useTheme } from '../utils/theme';

export default function MoneyScreen() {
  const theme = useTheme();
  const { payments, transactions, loaded, addPayment, updatePayment, deletePayment, markPaid, unmarkPaid } =
    useFinance();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringPayment | null>(null);

  const today = todayYMD();

  function openAdd() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(bill: RecurringPayment) {
    setEditing(bill);
    setFormOpen(true);
  }

  async function handleSubmit(input: RecurringInput) {
    // Keep the form open if the save failed (the hook has already alerted).
    const ok = editing ? await updatePayment(editing.id, input) : await addPayment(input);
    if (ok) setFormOpen(false);
  }

  async function handleDelete() {
    if (editing && (await deletePayment(editing.id))) setFormOpen(false);
  }

  function togglePaid(occ: Occurrence) {
    if (occ.paid) unmarkPaid(occ);
    else markPaid(occ);
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.background }}>
      {/* ── Header ── */}
      <View className="flex-row items-center justify-between px-4 pt-4 pb-3">
        <View>
          <Text className="text-2xl font-bold text-stone-800 dark:text-stone-100">Money</Text>
          <Text className="text-xs text-stone-500 dark:text-stone-400">Bills and regular payments</Text>
        </View>
        <TouchableOpacity className="bg-teal-600 rounded-full px-4 py-2" onPress={openAdd}>
          <Text className="text-white text-sm font-bold">+ Add Bill</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {loaded && (
          <BillsView
            payments={payments}
            transactions={transactions}
            today={today}
            onEdit={openEdit}
            onTogglePaid={togglePaid}
          />
        )}
      </ScrollView>

      <BillForm
        visible={formOpen}
        bill={editing}
        onSubmit={handleSubmit}
        onDelete={handleDelete}
        onClose={() => setFormOpen(false)}
      />
    </SafeAreaView>
  );
}
