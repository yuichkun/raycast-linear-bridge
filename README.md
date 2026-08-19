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
| **Create Task** | view | Creates a task with a status (defaults to In Progress) — local-only by default, or check "Save to Linear" to create a real Linear issue instead, additionally picking a team (defaults to General). |
| **Archive Completed Tasks** | no-view | Archives every Done task (and drops local-only completed tasks from the cache) after a confirmation prompt. |
| **Sync** | no-view, runs automatically every 5 minutes | Pushes any pending offline changes to Linear, then pulls the latest state. Can also be run manually from Raycast's root search. |

## Keyboard shortcuts (in List Tasks)

`Enter` opens the full-screen detail view for the selected task. The rest use `⌘⇧` on macOS / `Ctrl⇧` on Windows, matching Todo Buddy's layout where the same action exists.

| Shortcut | Action |
|---|---|
| `↵` (Enter) | View Task (full-screen detail) |
| `⌘⇧E` | Edit Task — one form for title, due date, priority, description, and (for Linear tasks) status and labels |
| `⌘⇧O` | Open in Browser (Linear tasks only — a local-only task has no Linear URL yet) |
| `⌘⇧C` | Mark as Complete — toggles back to In Progress if the task is already Done |
| `⌘⇧P` | Mark as In Progress — toggles back to Todo if the task is already In Progress |
| `⌘⇧U` | Promote to Linear (local-only tasks only) |
| `⌘⇧⌫` | Archive Task |

`⌘D` (no Shift) toggles the inline detail panel next to the list on and off.

## Local-only tasks

Every task you create starts out **local-only**: it lives entirely in Raycast's local storage and is never sent to Linear. This is deliberate — Todo Buddy's actual daily use includes a lot of quick, personal, "don't forget this" notes that would just be noise in a shared Linear workspace if every one of them became a real issue.

The only thing "local-only" changes is whether the task exists in Linear — not how it behaves otherwise. A local-only task has a real stage (Backlog/Todo/In Progress/Done) just like any other task, sits in the same dynamic sections, and responds to Mark as Complete/Mark as in Progress the same way. A small drive icon and a "Local only — not saved to Linear" line in its detail panel are the only visible difference. When you decide a task actually belongs in Linear, use **Promote to Linear** (`⌘⇧U`) to pick a team and status and create the real issue — its current stage is carried over as the default status (a task that was In Progress locally defaults to that team's In Progress, not back to square one) — from that point on it behaves exactly like any other synced task. There's no way back from Linear to local-only, on purpose: that would mean deleting an issue other people may already be looking at.

**Local-only tasks have no backup.** Since they never reach Linear, if Raycast's local storage for this extension is ever cleared (extension reinstall, Raycast data reset, etc.), they're gone for good. This tradeoff was made deliberately in exchange for not re-adding an Export/Import feature.

## Offline-first design

- Every mutation (complete, edit, archive, …) writes to a local cache immediately and returns — there is no waiting on a network request.
- Changes are queued and pushed to Linear in the background, both right after you make them and on a 5-minute interval.
- If you're offline, changes simply queue up until the next successful sync; nothing is lost.
- Manual reordering and pinning — which existed in Todo Buddy — were deliberately dropped in favor of Linear's own per-state sections, since Linear's own manual ordering is shared workspace-wide and would otherwise quietly reorder things for your teammates too.
