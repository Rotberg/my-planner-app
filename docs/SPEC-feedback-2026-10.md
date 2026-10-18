# Spec: Unified tasks, Planner/Tasks UI fixes, shopping suggestions, step tracking

Status: draft, 2026-10-10. Based on code at commit `f7002dd`.

---

## 0. Findings from the current code

| Area | What the code does today | Why the user sees the problem |
|---|---|---|
| Events vs tasks | Planner events live in AsyncStorage key `planner_events` (`PlannerScreen.tsx`). Tasks live in key `tasks` (`TasksScreen.js`). Two shapes, two forms. | Adding an event on the Planner never creates a task, and events never show on the Tasks tab. |
| Planner filter chips | Chips sit in a horizontal `ScrollView` with no `flexGrow: 0`. RN gives ScrollView `flexGrow: 1`, so it expands vertically and stretches each chip. | Chips are very tall, and they eat the space below the calendar. |
| Tasks on calendar | Tasks *are* read on focus and rendered in the day list. But (a) the stretched filter row squeezes the day list to a sliver, so items below the events are effectively hidden, (b) recurring tasks only exist as their *next* instance, so future repeats never appear, (c) all items share one teal dot. | Looks like tasks are missing. |
| Tasks screen | Commit `f7002dd` already collapses the form behind "+ Add Task" and defaults to today. Tasks are loaded only on mount (`useEffect`), not on focus. | If the phone is still on an older build/update, the old always-open form is what the user sees. Needs a fresh EAS build/update to verify. |
| Shopping suggestions | Suggestions only come from the remote `catalog_items` + `favorite_items`. Items you type are never recorded anywhere suggestions read from. Fetch errors are swallowed (`const { data } = ...`), so a failed fetch or RLS-blocked select gives an empty list silently. | Previous entries never appear as suggestions. Possibly nothing appears at all if the fetch fails. |
| Dark mode | Calendar day numbers use hard-coded `#1f2933`. | Unreadable day numbers in dark mode (bonus fix). |

---

## 1. General: one underlying item type ("tasks")

### 1.1 Data model

Single AsyncStorage key `tasks`. New shared module `utils/tasks.ts` owns the type and all reads/writes. Both screens use it; no screen touches storage directly.

```ts
type Task = {
  id: string;
  title: string;
  notes?: string;               // from old events
  date: string;                 // 'YYYY-MM-DD' local. Replaces ISO `dueDate`.
  startTime?: string;           // 'HH:MM' 24h. Replaces `dueTime` / event `time`.
  endTime?: string;             // 'HH:MM'
  priority: 'low' | 'medium' | 'high';
  recurrence: 'none' | 'daily' | 'weekly' | 'monthly';
  tags: string[];               // includes the progress tag, see §3.2
  done: boolean;
  notificationId?: string | null;
  createdAt: string;            // ISO, for stable sort
};
```

Storing `date` as a local `YYYY-MM-DD` string removes the UTC/local-date bugs that `d1fa0f8` had to patch around.

### 1.2 Migration (runs once on first load)

1. Read `tasks`. Map old fields: `dueDate` ISO → local `YYYY-MM-DD`, `dueTime` → `startTime`, default `notes`, `createdAt`.
2. Read `planner_events`. Convert each to a Task: `time` → `startTime`, keep `notes` and `notificationId`, `priority: 'medium'`, `recurrence: 'none'`, `tags: []`, `done: false`.
3. Save merged list to `tasks`, set `tasks:schemaVersion = 2`, delete `planner_events`.
4. Skip all of this when `schemaVersion >= 2`.

### 1.3 Shared API (`utils/tasks.ts`)

- `loadTasks()`, `saveTasks()`, `addTask()`, `updateTask()`, `deleteTask()`, `toggleDone()`.
- `occursOn(task, ymd)`: true if the task is on that date, including projected repeats for recurring tasks (see 1.5).
- `tasksForDate(tasks, ymd)`: sorted by start time, untimed last.
- Notification handling moves here. Any task with a `startTime` gets a notification. Edits reschedule, deletes cancel.

### 1.4 Shared form component

New `components/TaskForm.tsx`, extracted from the Tasks screen form: title, notes, priority, date, start/end time, repeat, tags, progress-tag toggle.

- Tasks tab: opens it in the same expandable card/sheet, date defaults to today.
- Planner: "+ Add" opens it in the existing bottom-sheet modal, date prefilled to the selected day.
- Tapping a task in either screen opens the same form in edit mode.

### 1.5 Recurring tasks

Keep the existing "complete spawns next instance" model so history of done instances is kept. On the calendar, project virtual occurrences for dates after the stored instance. Virtual occurrences render greyed and are read-only until they become the real instance.

### 1.6 Both screens reload on focus

Switch `TasksScreen` from `useEffect` to `useFocusEffect` so changes made on the Planner show immediately.

---

## 2. Planner tab

### 2.1 Filter chips

- Add `style={{ flexGrow: 0 }}` to the horizontal ScrollView and `alignItems: 'center'` to its content container. This is the root-cause fix for the height.
- Chips: fixed height 28, horizontal padding 12, text 12–13px semibold, rounded-full. Keep per-filter colours.
- Update filters for the unified model. "Events", "One-off" and "Routine" go away.
- Filters become independent on/off toggles instead of one exclusive choice:

  | Chip | Shows | Default |
  |---|---|---|
  | Tasks | One-off tasks | On |
  | Repeating | Weekly and monthly repeating tasks | On |
  | Daily | Daily repeating tasks | **Off** |
  | Must Do | Tasks tagged Must Do | On |
  | Workouts | Workout sessions | On |
  | Health | Body stats entries | On |

- Daily repeats are off by default because they would put a dot on every day and clutter the calendar.
- Future daily repeats only show when Daily is on, even if they are tagged Must Do. Otherwise a daily Must Do task would put a dot on every day.
- A daily Must Do task's current instance, normally today's, still shows while Must Do is on.
- Tapping an upcoming repeat explains that it edits the whole series before opening the form.
- Any other task shows if its type chip or Must Do is on.
- Remember the chip state in AsyncStorage so it persists between sessions.

### 2.2 Tasks on the calendar

- Day list shows all tasks from `tasksForDate`, plus workouts and health stats as today.
- Calendar cell: up to 3 small dots in category colours (task, workout, health) instead of one teal dot.
- Day list cards get a checkbox so tasks can be ticked off from the Planner.
- Day list should take remaining height (the chip fix above restores this).

### 2.3 Bonus

Replace hard-coded calendar text colours with `theme` values for dark mode.

---

## 3. Tasks tab

### 3.1 Layout

Top to bottom:

1. Header: "Today", date, and a "+ Add" button. The form is hidden until tapped, opens as a modal sheet so it never pushes the list off-screen.
2. Daily progress card (§3.2).
3. Today's list: only items where `occursOn(task, today)`. Sorted untimed-must-do first, then by start time, done items sink to the bottom.
4. Optional "Overdue (n)" collapsible section for undone items from earlier days. No "show all" here; the Planner is the place to browse other dates.

Compact card: checkbox, title, time range, small tag chips. Move edit to tap-on-card and delete to long-press, removing the ✎ and ✕ icons. Priority becomes a coloured left border instead of a badge. This roughly doubles how many tasks fit on screen.

### 3.2 Daily progress tag

**Proposed name: "Must Do".** It reads clearly as "counts towards today's goal" and won't be confused with the existing "Daily" preset tag. Alternatives: "Daily Goal", "Focus", "To Do".

- Stored as the tag `Must Do` in `tags`, so it shows and filters like any other tag. Rendered with a distinct colour and pinned first in the tag picker.
- Toggle in the form: "Count towards daily progress".
- Progress card on the Tasks tab:

  ```
  Today's progress   7 / 10  ·  70%
  [██████████████░░░░░░]
  ```

- Formula: done Must Do tasks dated today ÷ all Must Do tasks dated today. Recurring tasks count via today's instance.
- With zero Must Do tasks today, show a hint: "Tag tasks as Must Do to track daily progress."
- At 100% show a small completion state (colour change, ✓).

Decided: only tasks dated today count. Undone Must Do tasks from earlier days do not carry over into today's progress.

---

## 4. Shopping list suggestions

### 4.1 Cause

Typed item names never feed the suggestion source. Suggestions only read the curated catalog and favourites from the remote database, and fetch failures are silent.

### 4.2 Fix

- Build an `itemHistory` source: distinct names from `shopping_list_items` (all saved lists) plus the current local list, with a use-count.
- Every time an item is added, record its name locally in AsyncStorage key `shopping:itemHistory` as `{ name, count, lastUsed }`. This works offline and doesn't depend on saving a list.
- Merge sources: favourites, then history ranked by count and recency, then catalog. De-dupe case-insensitively.
- Match on prefix first, then substring. Show suggestions after 1 character, max 6.
- Remember the category last used for each name, and pre-select it when a suggestion is tapped.
- Log or surface fetch errors instead of discarding them, so a server or config problem is visible.

### 4.3 Remote database removed (2026-10-10)

The remote database stopped resolving, which broke every remote feature. All data now lives on the device in `utils/localDb.ts`, so suggestions no longer depend on a server.

---

## 5. Health: step tracking (feasibility)

**Answer: feasible on Android, moderate effort, needs a development build.** The app already uses EAS dev builds, so that requirement is met.

| Option | Verdict |
|---|---|
| `expo-sensors` Pedometer | Not suitable. On Android it only counts live steps while the app is open; historical daily totals are iOS-only. |
| **Health Connect** via `react-native-health-connect` + `expo-health-connect` config plugin | Recommended. Reads the daily step totals the phone already records from Google Fit, Samsung Health, Fitbit, etc. |
| Google Fit API | Deprecated in favour of Health Connect. Avoid. |

Requirements and gotchas:

- Android 8+ (minSdk 26). Health Connect is built into Android 14+, and older phones need the Health Connect app from Play Store.
- Add the `READ_STEPS` permission and a permissions-rationale screen. The config plugin wires the manifest.
- Needs `expo-build-properties` for minSdk/compileSdk, then a new EAS build. It won't work in Expo Go.
- Publishing on Google Play requires a Health Connect permissions declaration form. Sideloaded/internal APKs don't need it.
- iOS would need a separate HealthKit integration. Decided: Android only for now.

Proposed feature:

- Health tab: "Steps today" card with a goal ring (default 10,000, editable) and a 7-day bar chart.
- Planner: daily step total as an optional item under the Health filter.
- Read-only. Step data is not stored by the app; Health Connect keeps the history.

Estimate: roughly 1–2 days including the build and permissions flow.

---

## 6. Suggested build order

1. Planner chip height fix + dark-mode calendar colours. Small and independent.
2. Shopping suggestions from history + surfaced fetch errors.
3. `utils/tasks.ts`, migration, shared `TaskForm`.
4. Planner and Tasks screens moved onto the shared model. Calendar dots and checkboxes.
5. Tasks layout rework + Must Do progress bar.
6. Health Connect steps, in its own branch because it needs a native rebuild.

## 7. Decisions

1. The progress tag is called **Must Do**.
2. Progress is today only. Overdue Must Do tasks are not counted.
3. The Planner keeps a Repeating filter for weekly and monthly tasks. Daily repeats get their own filter, off by default (see 2.1).
4. Step tracking is Android only for now, using Health Connect.
