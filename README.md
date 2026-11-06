# Linear Bridge

A fast, offline-first, keyboard-driven task list for Raycast — backed by [Linear](https://linear.app) instead of local storage.

Linear Bridge ports the operating feel of [Todo Buddy](https://github.com/yuichkun/raycast-todo-buddy) (a purely local Raycast todo extension) onto Linear as the backend, while keeping every mutation instant and working offline. It also supports **local-only tasks** — a quick way to jot something down without it ever touching Linear — for the "I need to remember this before I forget it" moments that don't belong in a shared workspace.

## Setup

### 1. Generate a Linear Personal API Key

1. In Linear, go to **Settings → Account → Security & Access → Personal API keys**.
2. Create a new key.
3. **Do not restrict it to specific teams.** This extension reads and creates issues across every team you belong to (`assignee: me`, no team filter) — a team-restricted key will silently miss issues in the teams it excludes.

### 2. Add the key to the extension

Open Raycast's extension preferences for Linear Bridge (`⌘,` → Extensions → Linear Bridge) and paste the key into **Linear Personal API Key**.

That's it — no OAuth, no separate "who am I" setting. Linear resolves the key's owner itself (`viewer`), so swapping the key is enough to switch accounts (e.g. for someone else on your team using the same extension install).

## Commands

| Command | Mode | What it does |
|---|---|---|
| **List Tasks** | view | Main screen. Sections: Outdated (past-due, ignores search) → one section per Linear state actually in use (Backlog, Todo, Pending, In Progress, …) → Done. Pressing Enter on a task opens a full-screen detail view; the inline detail panel is off by default (`⌘D` toggles it). |
| **Create Task** | view | Creates a task with a status (defaults to Todo) — local-only by default, or check "Save to Linear" to create a real Linear issue instead, additionally picking a team (defaults to General). |
| **Archive Completed Tasks** | no-view | Archives every Done task (and drops local-only completed tasks from the cache) after a confirmation prompt. |
| **Sync** | no-view, runs automatically every 5 minutes | Pushes any pending offline changes to Linear, then pulls the latest state. Can also be run manually from Raycast's root search. |

## Keyboard shortcuts (in List Tasks)

`Enter` opens the full-screen detail view for the selected task. The rest use `⌘⇧` on macOS / `Ctrl⇧` on Windows, matching Todo Buddy's layout where the same action exists.

| Shortcut | Action |
|---|---|
| `↵` (Enter) | View Task (full-screen detail) |
| `⌘⇧E` | Edit Task — one form for title, due date, priority, description, and (for Linear tasks) status and labels |
| `⌘⇧D` | Set Due Date — quick date picker, no need to open the full Edit Task form |
| `⌘⇧S` | Change Status — inline submenu of the task's team states (or LOCAL_STAGES for local-only), no screen change |
| `⌘⇧M` | Add Comment (Linear tasks only) — one text box, queued and synced like every other change |
| `⌘⇧O` | Open in Linear — on macOS with the Linear desktop app installed, opens the issue there; otherwise Open in Browser (Linear tasks only — a local-only task has no Linear URL yet) |
| `⌘⇧C` | Mark as Complete — toggles back to In Progress if the task is already Done |
| `⌘⇧P` | Mark as In Progress — toggles back to Todo if the task is already In Progress |
| `⌘⇧U` | Promote to Linear (local-only tasks only) |
| `⌘⇧F` | Filter Teams — pick which teams' tasks are shown in the list (empty selection = all teams) |
| `⌘⇧⌫` | Archive Task |

`⌘D` (no Shift) toggles the inline detail panel next to the list on and off.

Mark as Complete, Mark as In Progress and Mark as Todo move a Linear task to the **first** state of that type in its team's workflow — the one listed first under Completed, Started or Unstarted in the team's workflow settings in Linear (the same "first Started status" rule Linear's own automations use). Reordering a team's states in Linear changes where these shortcuts send a task. For any other state, use Change Status.

## Team filter

**Filter Teams** (`⌘⇧F`) opens a form where you pick the teams whose tasks List Tasks shows — an explicit allow-list. An empty selection shows every team. It's a display-level filter only:

- With a selection active, every other team's tasks disappear from every section — Outdated and Done included — and from search results.
- A team created later stays hidden until you add it to the selection.
- Local-only tasks have no team and are always shown.
- Sync still fetches and pushes every team's issues, so widening the filter is instant and works offline. Create Task and Promote to Linear also keep offering every team.
- While the filter is active, the window title reads "List Tasks — filtered to N teams" so filtered-out tasks never look like lost tasks.
- The selection is saved to the extension's support directory and survives restarts (and the "Clear Local Storage & Cache" debug action).

## Due-date dropdown

The dropdown at the right of the search bar (`⌘P` focuses it) limits List Tasks by due date. Each choice hides tasks due *after* its last day; everything else stays:

| Choice | Shows tasks due… |
|---|---|
| **All** | any time (default) |
| **Due Today** | today or earlier |
| **Due Within 7 Days** | through today + 7 days, inclusive |
| **Due Within 30 Days** | through today + 30 days, inclusive |

The windows are rolling, not calendar periods, on purpose: a "this week" that ends on Sunday hides Monday's deadline when you open the list on Sunday night, and a "this month" that ends on the 31st hides the 1st — blind exactly when a near deadline matters most. A fixed 30 days (rather than "the same day next month") also means there are no month-length edge cases.

Two things always stay visible regardless of the choice: **overdue tasks** (a past date is never after the horizon) and **tasks with no due date** — the latter on purpose, so undated tasks keep nudging you to give them a date instead of quietly vanishing from a "just today" view. **Done tasks are hidden under every choice except All**: a horizon is a "what needs doing by then" lens, and done items aren't to-dos. The choice persists the same way as the team filter, and it leaves the search box free, so you can keep "Due Today" on and still search for anything.

## Comments

The full-screen detail view (`Enter`) loads the issue's Linear comments below the description as a nested list. They follow Linear's own model: a thread is a root comment plus its replies, shown as nested items (`↳`); a resolved thread is marked `✓ Resolved` on its root and `✓ Resolution` on the reply that settled it; an inline comment shows the description snippet it's anchored to; edits and emoji reactions are noted on the header line. Timestamps are short — just the time for today's comments, month/day for this year, the full date otherwise. Authors can be workspace users, bots (Linear Agent, integrations), or external people on synced Slack/email threads.

Comments are fetched live when the view opens rather than kept in the offline cache. If Linear is unreachable, the last-loaded comments are shown when there are any. Local-only tasks have no Linear issue and therefore no comments section.

**Add Comment** (`⌘⇧M`) opens a single text box (Markdown works). It's its own operation — independent of any status change — and goes through the same offline-first queue as every other mutation, so it returns instantly. Until the next sync delivers it, the comment appears in the detail view as **You · (pending sync)**. If Linear rejects it, the Sync command's toast includes the comment text so it isn't lost silently. Only tasks that already exist in Linear can take comments.

## Local-only tasks

Every task you create starts out **local-only**: it lives entirely in Raycast's local storage and is never sent to Linear. This is deliberate — Todo Buddy's actual daily use includes a lot of quick, personal, "don't forget this" notes that would just be noise in a shared Linear workspace if every one of them became a real issue.

The only thing "local-only" changes is whether the task exists in Linear — not how it behaves otherwise. A local-only task has a real stage (Backlog/Todo/In Progress/Done) just like any other task, sits in the same dynamic sections, and responds to Mark as Complete/Mark as in Progress the same way. A small drive icon and a "Local only — not saved to Linear" line in its detail panel are the only visible difference. When you decide a task actually belongs in Linear, use **Promote to Linear** (`⌘⇧U`) to pick a team and status and create the real issue — its current stage is carried over as the default status (a task that was In Progress locally defaults to that team's In Progress, not back to square one) — from that point on it behaves exactly like any other synced task. There's no way back from Linear to local-only, on purpose: that would mean deleting an issue other people may already be looking at.

**Local-only tasks have no backup.** Since they never reach Linear, if Raycast's local storage for this extension is ever cleared (extension reinstall, Raycast data reset, etc.), they're gone for good. This tradeoff was made deliberately in exchange for not re-adding an Export/Import feature.

## Offline-first design

- Every mutation (complete, edit, archive, …) writes to a local cache immediately and returns — there is no waiting on a network request.
- Changes are queued and pushed to Linear in the background, both right after you make them and on a 5-minute interval.
- If you're offline, changes simply queue up until the next successful sync; nothing is lost. The same goes for when Linear answers but doesn't take the change — it's rate limiting, failing on its side (5xx), or not accepting the API key: the change stays queued and is sent again on a later sync. Changes to one issue always reach Linear in the order they were made.
- Only a change Linear actually refuses (a validation error, say) is rolled back locally, and the Sync command reports it. A task Linear refuses to create goes back to being local-only, with what you wrote in it, rather than disappearing.
- A task saved to Linear works like any other while its create is still queued: edits, status changes and archiving are queued behind the create and follow it to Linear.
- Creating things is idempotent: a queued issue or comment carries a client-generated UUID that Linear adopts as its id, so a change sent twice (overlapping syncs, or a process torn down between sending and dequeuing) can never become a duplicate. Sync runs within one process are also serialized, with at most one follow-up run chained behind the current one.
- Manual reordering and pinning — which existed in Todo Buddy — were deliberately dropped in favor of Linear's own per-state sections, since Linear's own manual ordering is shared workspace-wide and would otherwise quietly reorder things for your teammates too.
