# Spec: Financial planning ("Money") tab

Status: draft, 2026-10-17. Based on code at commit `8fd0126` (branch `feat/financial-planning`).

---

## 0. Goal

Add a fifth area to the app for planning money, built around two ideas:

1. **Ongoing payments.** Rent, bills, subscriptions, loans and anything else that repeats. You should always know what's due next and how much of this month's money is already spoken for.
2. **Unexpected payments.** One-off costs you didn't plan for (a car repair, a vet bill, a broken phone). Log them quickly, see how much they've cost you, and keep money set aside so they don't wreck the month.

Out of scope for v1 (see §9): bank syncing, investments, multi-currency, shared budgets.

The app is on-device only (no Supabase), so everything is entered by hand and stored through `utils/localDb.ts`.

---

## 1. What real apps do, and what we'll copy

| App | Relevant feature | What we take from it |
|---|---|---|
| **YNAB** | "Embrace your true expenses" (Rule 2): big or irregular costs are split into monthly amounts using category **targets**. Each target shows how much is still needed before the due date. | **Sinking-fund pots** for irregular costs (car insurance, MOT, Christmas). The pot shows "£X/month to be ready by <date>". Also an **emergency/unexpected buffer** you fund each month. |
| **Monarch Money** | **Recurring** section: a month **calendar** of upcoming bills, tick a bill off as paid, list view grouped by frequency/category/amount, reminder 3 days before a charge. | **Bills calendar + list**, a **mark-as-paid** tick per occurrence, a **reminder N days before** (default 3), and grouping by frequency/category. |
| **Emma** (UK) | **Committed spending** (rent, subscriptions, utilities). **Left to spend** = budget − committed − spent so far. Daily allowance after upcoming bills. | The headline number on the overview: **Left to spend this month** (plus a per-day figure). |
| **Snoop / Money Dashboard style** | Spotting subscriptions and price rises. | **Price-change history** on a recurring payment ("Netflix went £10.99 → £12.99"). Yearly cost shown next to monthly ("£12.99/mo = £155.88/yr"). |

Design direction: **Emma's headline number, Monarch's bills calendar, YNAB's pots.** Kept manual and simple. This is a planner, not a bank app.

---

## 2. Navigation: where the tab goes

Today the bar has 4 visible tabs (Tasks, Planner, Shopping, Health; `index` is hidden). Apple's guidelines say 3–5 tabs on iPhone, and Material 3's navigation bar says 3–5 destinations. Beyond 5, iOS falls back to a "More" tab, which Apple warns makes content harder to find.

### Options

| Option | How it works | Pros | Cons |
|---|---|---|---|
| **A. 5th tab "Money"** ✅ recommended | Add `app/(tabs)/money.tsx` to the existing `Tabs`. Label "Money" (short enough for 5 labels on a 360dp phone). | One tap away like everything else. Least code. Within both platforms' guidelines. | That's the limit: a 6th feature needs B or C. |
| **B. "More" hub tab** | Replace Health (or the 5th slot) with "More", a screen of large cards: Health, Money, and later Settings. Each opens a stack screen. | Scales to any number of features. Room for Settings/Export later. | Health and Money become 2 taps. Hides features. |
| **C. Merge Tasks + Planner into "Plan"** | Tasks and Planner already share one data model (`utils/tasks.ts`, unified in the 2026-10 spec). One tab with a **List / Calendar** toggle at the top. | Frees a slot so the bar stays at 4. Arguably cleaner, since they're two views of the same thing. | Biggest change. Touches two working screens. |
| D. Side drawer | Hamburger menu. | Unlimited items. | Poor discoverability. Doesn't match the rest of the app. Not recommended. |

**Recommendation:** go with **A** now. It fits. If a 6th feature arrives, do **C** next (it removes a real duplication rather than hiding things), and keep **B** as the fallback.

Implementation for A:
- `app/(tabs)/money.tsx` → `export { default } from '@/screens/MoneyScreen';` (same pattern as the other tabs).
- `_layout.tsx`: add `<Tabs.Screen name="money" options={{ title: 'Money', tabBarIcon: … 'sterlingsign.circle.fill' }} />` after Shopping (money sits next to shopping, health stays last).
- `components/ui/icon-symbol.tsx`: map `'sterlingsign.circle.fill'` → `'currency-pound'` (or `'creditcard.fill'` → `'credit-card'` if we want a currency-neutral icon).

### Inside the tab

Use the same segmented `view` state pattern as `HealthScreen` (`'workout' | 'stats'`) and `ShoppingScreen` (`'current' | 'history'`):

```
[ Overview ] [ Bills ] [ Unexpected ]
```

---

## 3. Screens

### 3.1 Overview

Matches a budget **period**, which defaults to the calendar month. The user can change it to start on payday (e.g. the 25th), since many UK users budget payday-to-payday. The setting is "My month starts on day [1–28]" in a small settings sheet (gear icon in the Money header). It's capped at 28 so every month has that day. Changing it only changes how totals are grouped. No data is touched.

```
┌─────────────────────────────────┐
│ October  ‹ ›          (25 Sep–24 Oct)
│                                 │
│   Left to spend                 │
│   £642.18        ≈ £91/day      │   ← big number (Emma)
│                                 │
│ Income            £2,400.00     │
│ Bills (committed) −£1,310.00    │   paid £980 · due £330
│ Pots              −£250.00      │   sinking funds + buffer
│ Unexpected        −£197.82      │   3 this month
│ ───────────────────────────     │
│ Coming up                       │
│  Thu 23  Council tax   £148  ○  │   tap ○ to mark paid
│  Sat 25  Spotify       £11.99 ○ │
│                                 │
│ Unexpected buffer  £53 of £250 left  ▓▓░░░░  │
└─────────────────────────────────┘
```

**Left to spend** = income − all bills due in the period (paid or not) − pot contributions − unexpected spend in the period.
**Per day** = left to spend ÷ days remaining in the period (including today).

**Income is optional.** The Overview adapts to what the user has entered:

- **With income items:** headline is **Left to spend** (as above), with an Income row.
- **Without income:** headline becomes **Spent / committed this month** (bills + pots + unexpected). The Income row is hidden and a dismissible hint reads "Add your income to see what's left to spend". Once dismissed, the hint stays hidden (`finance:settings.hideIncomeHint`).

### 3.2 Bills (ongoing payments)

- Toggle **List / Calendar** (Monarch).
  - **List:** grouped by "Due this week", "Later this month", "Next month". Each row: name, category colour dot, amount, due date, paid tick.
  - **Calendar:** month grid with a dot on due days. Tap a day to see its bills. Reuse the calendar component/styles from `PlannerScreen` where possible.
- Totals at the top: **£X/month**, **£Y/year** across all active bills (yearly-equivalent normalised, see §4.3).
- **+ Add bill** opens a form (§3.4).
- Swipe or long-press a bill: Edit, Pause, Delete.
- **Mark as paid** creates a transaction for that occurrence (§4.2). The tick can be undone.
- **Overdue** occurrences (date passed, not ticked) show in red at the top until they're ticked or skipped.

### 3.3 Unexpected

- Quick-add bar at the top: **amount + what was it** → saved with today's date. Category and notes are optional, via "More details".
- List of unexpected payments in the current period, newest first. Period total at the top.
- **Buffer card:** "You set aside £250/month for surprises. £53 left." Goes amber under 25% and red when overspent.
- **"Pay from pot"** option on each entry: take it from a sinking-fund pot instead of the buffer (e.g. car repair → "Car" pot).
- Small 6-month bar chart of unexpected spend per period, so patterns show ("the car keeps costing me money").

### 3.4 Add/edit bill form

| Field | Notes |
|---|---|
| Name | Required. Suggestions from previous names (same idea as shopping history). |
| Amount | Required. Numeric keypad, currency prefix. |
| Type | Bill · Subscription · Loan/credit · Savings transfer · **Income** |
| Frequency | Weekly · Fortnightly · Every 4 weeks · Monthly · Quarterly · Yearly |
| Next due date | Date picker. This is the anchor for the series. |
| Ends | Never (default) · On date · After N payments (loans, phone contracts) |
| Category | Housing, Utilities, Transport, Subscriptions, Insurance, Debt, Other (editable list). |
| Reminder | Off · On the day · 1 / **3** (default) / 7 days before |
| Notes | Optional. |

**Income** reuses the same form with `type: 'income'`, so a salary on the 25th is just a recurring item. "Every 4 weeks" and "fortnightly" exist because UK pay and some bills run on those cycles.

Keyboard handling: reuse whatever fix lands from `fix/keyboard-covers-note-task-input` (`TaskForm`) so the amount and notes inputs aren't hidden.

### 3.5 Pots (sinking funds + buffer)

Lives as a section on Overview (tap to manage), not its own segment, to keep 3 segments.

- **Buffer pot** (one, built in): monthly amount for unexpected costs. Unspent money can roll over (setting, on by default).
- **Sinking-fund pots:** name, target amount, target date. The app calculates **£/month needed** = (target − saved) ÷ months left (YNAB targets). Contributions are recorded automatically each period (planned money, not real transfers), and can be adjusted.
- Examples to show in the empty state: "Car insurance £540 by March", "Christmas £400 by December", "MOT & service £250 by June".

---

## 4. Data model

All money is stored as **integer pence** (`amount_minor`) to avoid floating-point errors (0.1 + 0.2). Dates use the existing local `YYYY-MM-DD` strings (`utils/dates.ts`).

### 4.1 New `localDb` tables

Add to `TableName` in `utils/localDb.ts`:

```ts
| 'finance_recurring'      // bills, subscriptions, income
| 'finance_transactions'   // paid occurrences + unexpected + pot spends
| 'finance_pots'           // sinking funds + the buffer
| 'finance_price_changes'  // amount history for recurring items
```

```ts
type Frequency = 'weekly' | 'fortnightly' | 'four_weekly' | 'monthly' | 'quarterly' | 'yearly';

type RecurringPayment = Row & {
  name: string;
  amount_minor: number;
  type: 'bill' | 'subscription' | 'debt' | 'savings' | 'income';
  frequency: Frequency;
  anchor_date: string;          // first/next due date, YYYY-MM-DD
  anchor_day?: number;          // day of month for monthly+ (31 → clamps to month end)
  end_date?: string | null;
  remaining_payments?: number | null;
  category: string;
  remind_days_before: number | null;   // null = off
  notification_id?: string | null;
  paused: boolean;
  notes?: string;
};

type Transaction = Row & {
  date: string;                 // when it was paid
  amount_minor: number;         // positive = money out, negative = money in
  name: string;
  category: string;
  kind: 'recurring' | 'unexpected' | 'pot';
  recurring_id?: string | null; // set when kind = 'recurring'
  due_date?: string | null;     // which occurrence this pays (recurring_id + due_date is unique)
  pot_id?: string | null;       // paid from a pot instead of the buffer
  skipped?: boolean;            // occurrence skipped, not paid (e.g. a paused gym month)
  notes?: string;
};

type Pot = Row & {
  name: string;
  kind: 'buffer' | 'sinking';
  monthly_amount_minor: number; // buffer: fixed; sinking: computed and stored when edited
  target_minor?: number | null;
  target_date?: string | null;
  balance_minor: number;        // contributions − spends, updated with transactions
  rollover: boolean;
};

type PriceChange = Row & { recurring_id: string; from_minor: number; to_minor: number; effective: string };
```

Cascade: deleting a `finance_recurring` row should **not** delete its transactions (paid history is still real). Add `finance_recurring → finance_price_changes` to `CASCADES` only.

### 4.2 Occurrences are computed, not stored

A recurring payment has no stored "instances". For any period, `occurrencesBetween(payment, from, to)` generates its due dates from `anchor_date`/`anchor_day`/`frequency`, respecting `end_date`, `remaining_payments` and `paused`.

An occurrence is **paid** if a transaction exists with that `recurring_id` + `due_date`, and **skipped** if that transaction has `skipped: true`. Ticking a bill inserts the transaction, and unticking deletes it. Editing a bill's amount only affects future occurrences, because past ones are frozen in their transactions. This matches how `utils/tasks.ts` projects recurring tasks (`occursOn`, `nextOccurrence` with `anchorDay`).

### 4.3 Settings

Single AsyncStorage key `finance:settings` (via `utils/storage.js`, like shopping history):

```ts
{ periodStartDay: 1, showBillsOnPlanner: false, defaultReminderDays: 3, hideIncomeHint: false }
```

Currency is **GBP only** for v1. `formatMoney` uses `Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })`. All formatting goes through `utils/money.ts`, so adding a currency setting later is a one-file change.

Normalised monthly cost (for "£X/month" totals): weekly × 52/12, fortnightly × 26/12, four_weekly × 13/12, quarterly ÷ 3, yearly ÷ 12.

---

## 5. Code layout

| File | Purpose |
|---|---|
| `utils/finance.ts` | Types, CRUD on the tables above, `occurrencesBetween`, `periodFor(date, startDay)`, `leftToSpend(period)`, `monthlyEquivalent`, reminder scheduling. Pure functions kept separate from I/O so they can be unit-tested. |
| `utils/recurrence.ts` *(extract)* | Move the month-end clamping in `nextOccurrence` out of `tasks.ts` so both tasks and finance use it. Add fortnightly/4-weekly/quarterly/yearly. |
| `utils/money.ts` | `formatMoney(minor)`, `parseMoney(input) → minor` (handles "12", "12.5", "£12.50", "12,50"). |
| `screens/MoneyScreen.tsx` | Segment switcher + Overview. |
| `components/finance/BillsView.tsx`, `UnexpectedView.tsx`, `BillForm.tsx`, `PotCard.tsx`, `LeftToSpendCard.tsx` | Split up from the start. `HealthScreen.tsx` is already ~1,500 lines; let's not repeat that. |
| `app/(tabs)/money.tsx` | Route re-export. |

---

## 6. Notifications

- Reuse `utils/notifications.ts` (`planner` Android channel, or add a `bills` channel so users can mute bills separately).
- Schedule **only the next occurrence** per recurring payment. iOS caps pending local notifications at 64, so scheduling a year of bills would hit the cap.
- Re-schedule on: app focus of the Money tab, marking paid, editing, and app launch (cheap: cancel + schedule for each active bill).
- Text: "Council tax £148.00 is due Thursday".

---

## 7. Integration with the rest of the app

- **Planner (optional, setting `showBillsOnPlanner`):** show bill due dates as a separate dot colour on the Planner calendar, read-only. They are *not* turned into tasks, which keeps the unified tasks model clean.
- **Shopping (later):** "Log this shop as spending" when a list is completed. Not v1.

---

## 8. Phased delivery

| Phase | Scope | Done when |
|---|---|---|
| 1 | Tab + navigation, `localDb` tables, `utils/money.ts`, Bills list with add/edit/delete, mark paid, monthly/yearly totals. | Can add rent + Netflix, tick them off, see £/month. |
| 2 | Unexpected quick-add + list, buffer pot, Overview with **Left to spend**, income items, payday period start. | Overview number is correct for a test month (unit-test `leftToSpend`). |
| 3 | Reminders, Bills calendar view, overdue state, price-change history. | Reminder fires 3 days before a test bill. |
| 4 | Sinking-fund pots, pay-from-pot, 6-month unexpected chart, optional Planner dots. | |

---

## 9. Not in v1 (possible later)

- Bank sync via Open Banking (TrueLayer, GoCardless). Needs a backend, which conflicts with the on-device decision.
- Receipt photos on unexpected payments (`expo-image-picker`).
- CSV export/import of transactions.
- Debt payoff planner (snowball/avalanche).
- Multiple currencies.

---

## 10. Decisions (2026-10-17)

1. **Navigation:** 5th tab "Money" (option A).
2. **Period:** calendar month by default. The user can set the month to start on their payday (day 1–28) in Money settings.
3. **Income:** supported but optional. The Overview switches between "Left to spend" and "Spent / committed" depending on whether income exists.
4. **Currency:** GBP only for v1, isolated in `utils/money.ts`.
5. **Pots:** the single unexpected buffer ships in phase 2. Savings pots for irregular costs stay in phase 4.

---

### Sources

- YNAB: [What is a sinking fund](https://www.ynab.com/blog/what-is-a-sinking-fund)
- Monarch: [Track recurring bills and subscriptions](https://www.monarchmoney.com/whats-new/track-recurring-bills-and-subscriptions), [Recurring on mobile](https://monarchmoney.com/features/recurring)
- Emma: [Subscriptions](https://emma-app.com/subscriptions), [Budgeting](https://emma-app.com/features/tracking/budgeting/), [Community: left to spend / committed spending](https://community.emma-app.com/t/safe-to-spend-feature/1377)
- Apple HIG: [Tab bars](https://developer-rno.apple.com/design/human-interface-guidelines/components/navigation-and-search/tab-bars)
