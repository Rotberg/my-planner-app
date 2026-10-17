import React, { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BillForm from '../components/finance/BillForm';
import BillsView from '../components/finance/BillsView';
import MoneySettings from '../components/finance/MoneySettings';
import OverviewView from '../components/finance/OverviewView';
import UnexpectedForm from '../components/finance/UnexpectedForm';
import UnexpectedView from '../components/finance/UnexpectedView';
import { IconSymbol } from '../components/ui/icon-symbol';
import { syncBillReminders } from '../utils/billReminders';
import { todayYMD } from '../utils/dates';
import {
  FinanceSettings,
  Occurrence,
  periodFor,
  periodLabel,
  RecurringInput,
  RecurringPayment,
  Transaction,
  UnexpectedInput,
  useFinance,
} from '../utils/finance';
import { requestNotificationPermissions } from '../utils/notifications';
import { useTheme } from '../utils/theme';

type Section = 'overview' | 'bills' | 'unexpected';

export default function MoneyScreen() {
  const theme = useTheme();
  const finance = useFinance();
  const { payments, transactions, settings, loaded } = finance;

  const [view, setView] = useState<Section>('overview');
  const [billOpen, setBillOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<RecurringPayment | null>(null);
  const [newDirection, setNewDirection] = useState<'out' | 'in'>('out');
  const [unexpectedOpen, setUnexpectedOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Transaction | null>(null);
  const [draft, setDraft] = useState<{ name: string; amount: string } | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Keep reminders in step with bills and ticks (reloaded after every change).
  useEffect(() => {
    if (loaded) syncBillReminders({ payments, transactions });
  }, [loaded, payments, transactions]);

  const today = todayYMD();
  const period = periodFor(today, settings.periodStartDay);

  function openAddBill(direction: 'out' | 'in' = 'out') {
    setEditingBill(null);
    setNewDirection(direction);
    setBillOpen(true);
  }

  function openEditBill(bill: RecurringPayment) {
    setEditingBill(bill);
    setBillOpen(true);
  }

  async function submitBill(input: RecurringInput) {
    // Keep the form open if the save failed (the hook has already alerted).
    const ok = editingBill ? await finance.updatePayment(editingBill.id, input) : await finance.addPayment(input);
    if (!ok) return;
    setBillOpen(false);
    if (input.remind_days_before != null && Platform.OS !== 'web' && !(await requestNotificationPermissions())) {
      Alert.alert(
        'Notifications are off',
        'The bill is saved, but reminders can’t be sent until you allow notifications for this app in your phone’s settings.'
      );
    }
  }

  async function deleteBill() {
    if (editingBill && (await finance.deletePayment(editingBill.id))) setBillOpen(false);
  }

  function togglePaid(occ: Occurrence) {
    if (occ.paid) finance.unmarkPaid(occ);
    else finance.markPaid(occ);
  }

  function openUnexpected(entry: Transaction | null, d?: { name: string; amount: string }) {
    setEditingEntry(entry);
    setDraft(d);
    setUnexpectedOpen(true);
  }

  async function submitUnexpected(input: UnexpectedInput) {
    const ok = editingEntry
      ? await finance.updateUnexpected(editingEntry.id, input)
      : await finance.addUnexpected(input);
    if (ok) setUnexpectedOpen(false);
  }

  async function deleteUnexpected() {
    if (editingEntry && (await finance.deleteTransaction(editingEntry.id))) setUnexpectedOpen(false);
  }

  async function saveSettings(patch: Partial<FinanceSettings>) {
    if (await finance.saveSettings(patch)) setSettingsOpen(false);
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.background }}>
      {/* ── Header ── */}
      <View className="flex-row items-center justify-between px-4 pt-4">
        <Text className="text-2xl font-bold text-stone-800 dark:text-stone-100">Money</Text>
        <View className="flex-row items-center" style={{ gap: 12 }}>
          <TouchableOpacity hitSlop={10} onPress={() => setSettingsOpen(true)} accessibilityLabel="Money settings">
            <IconSymbol name="gearshape.fill" size={22} color={theme.icon} />
          </TouchableOpacity>
          {view !== 'unexpected' && (
            <TouchableOpacity className="bg-teal-600 rounded-full px-4 py-2" onPress={() => openAddBill()}>
              <Text className="text-white text-sm font-bold">+ Add</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Segments ── */}
      <View className="flex-row mx-4 mt-3 mb-3 bg-stone-200 dark:bg-stone-700 rounded-xl p-1">
        {([
          ['overview', 'Overview'],
          ['bills', 'Bills'],
          ['unexpected', 'Unexpected'],
        ] as const).map(([key, label]) => (
          <Pressable
            key={key}
            className={`flex-1 py-2 rounded-lg items-center ${view === key ? 'bg-white dark:bg-stone-800 shadow-sm' : ''}`}
            onPress={() => setView(key)}
          >
            <Text
              className={`text-sm font-semibold ${view === key ? 'text-teal-700' : 'text-stone-500 dark:text-stone-400'}`}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        {loaded && view === 'overview' && (
          <OverviewView
            payments={payments}
            transactions={transactions}
            settings={settings}
            today={today}
            onEdit={openEditBill}
            onTogglePaid={togglePaid}
            onAddIncome={() => openAddBill('in')}
            onDismissIncomeHint={() => finance.saveSettings({ hideIncomeHint: true })}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}
        {loaded && view === 'bills' && (
          <BillsView
            payments={payments}
            transactions={transactions}
            today={today}
            period={period}
            periodStartDay={settings.periodStartDay}
            onEdit={openEditBill}
            onTogglePaid={togglePaid}
          />
        )}
        {loaded && view === 'unexpected' && (
          <UnexpectedView
            transactions={transactions}
            period={period}
            periodName={periodLabel(period, settings.periodStartDay)}
            bufferMinor={settings.bufferMinor}
            today={today}
            onQuickAdd={finance.addUnexpected}
            onMoreDetails={(d) => openUnexpected(null, d)}
            onEdit={(entry) => openUnexpected(entry)}
          />
        )}
      </ScrollView>

      <BillForm
        visible={billOpen}
        bill={editingBill}
        defaultDirection={newDirection}
        onSubmit={submitBill}
        onDelete={deleteBill}
        onClose={() => setBillOpen(false)}
      />
      <UnexpectedForm
        visible={unexpectedOpen}
        entry={editingEntry}
        draft={draft}
        onSubmit={submitUnexpected}
        onDelete={deleteUnexpected}
        onClose={() => setUnexpectedOpen(false)}
      />
      <MoneySettings
        visible={settingsOpen}
        settings={settings}
        onSave={saveSettings}
        onClose={() => setSettingsOpen(false)}
      />
    </SafeAreaView>
  );
}
