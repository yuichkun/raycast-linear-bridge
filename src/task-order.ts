import { DueHorizon, dueHorizonEnd, isDueWithinHorizon, isPastDue } from "./date";
import { Task, WorkflowStateType } from "./types";

const HIDDEN_STATE_TYPES = new Set<WorkflowStateType>(["canceled", "duplicate"]);

// Ordered by how much a section should demand attention *right now*, not by Linear's own
// backlog->done workflow progression. A task tracker should surface what's already being
// worked on first — burying "In Progress"/"Pending" below a "Backlog" pile just because
// that's the order Linear's own board columns happen to render in would defeat the point
// of a daily-use task list. "completed" and "canceled"/"duplicate" are handled as their
// own fixed sections (Complete / hidden) and never appear here.
const STATUS_TYPE_ORDER: Partial<Record<WorkflowStateType, number>> = {
  started: 0,
  unstarted: 1,
  triage: 2,
  backlog: 3,
};

// Mirrors todo-buddy's emoji-prefixed section titles (⚠️ Outdated / 📌 Pinned / ✅ Done)
// for at-a-glance scanning. A pool per type rather than one fixed emoji per type: a single
// type can have multiple distinctly-named states in real workspaces (e.g. this workspace's
// "Pending" and "In Progress" are both type "started"), and giving them the same emoji would
// visually re-merge sections that were deliberately split apart to keep that distinction
// visible. Sections are assigned emoji in display order, so the first "started" section on
// screen gets the pool's first emoji, the second gets the next, etc.
const STATUS_TYPE_EMOJI_POOL: Partial<Record<WorkflowStateType, string[]>> = {
  started: ["🔥", "⚡", "🚀", "💪"],
  unstarted: ["📝", "🗒️", "📋"],
  triage: ["📥", "🔍", "❓"],
  backlog: ["🗂️", "📦", "🧊"],
};

// Display-level team filter, as an explicit allow-list: with a selection active, only the
// chosen teams' tasks are shown — a team missing from the selection (including one created
// after the filter was saved) stays hidden until added. An empty selection means no
// filtering at all, so the unconfigured default is the full list, not a blank one. Applies
// to every section, Outdated and Done included — unlike a search query (a transient
// lookup that deliberately never hides overdue tasks), the team filter is a statement
// about what belongs in this view at all. Local-only tasks carry no teamId and are never
// filtered out: narrowing to a team must not swallow personal don't-forget notes.
export function restrictToVisibleTeams(tasks: Task[], visibleTeamIds: string[]): Task[] {
  if (visibleTeamIds.length === 0) return tasks;
  const visible = new Set(visibleTeamIds);
  return tasks.filter((task) => !task.teamId || visible.has(task.teamId));
}

// Display-level due-date filter, driven by the dropdown in List Tasks' search bar. Hides
// tasks due after the horizon; undated and overdue tasks always stay (see
// isDueWithinHorizon for why). Completed tasks are dropped outright under any horizon:
// a horizon is a "what needs doing by then" lens, and done items aren't to-dos — plus,
// since overdue and undated tasks always pass, the Done section would otherwise survive
// nearly untouched (almost every finished task is either past its date or never had one).
// Under "all" nothing is filtered and Done shows as usual.
export function restrictToDueHorizon(tasks: Task[], horizon: DueHorizon, now: Date = new Date()): Task[] {
  const horizonEnd = dueHorizonEnd(horizon, now);
  if (!horizonEnd) return tasks;
  return tasks.filter((task) => task.stateType !== "completed" && isDueWithinHorizon(task.dueDate, horizonEnd));
}

export type SectionKind = "outdated" | "complete" | "hidden" | "state";

export function classifyTask(task: Task): SectionKind {
  if (task.stateType && HIDDEN_STATE_TYPES.has(task.stateType)) return "hidden";
  if (task.stateType === "completed") return "complete";
  if (isPastDue(task.dueDate)) return "outdated";
  return "state";
}

// Type first, then position within the type, compared one after the other. Folding both
// into one number (type * 1_000_000 + position) only held while every position stayed
// below a million — Linear's positions are open-ended floats.
type SortKey = { typeOrder: number; position: number };

function compareSortKeys(a: SortKey, b: SortKey): number {
  return a.typeOrder - b.typeOrder || a.position - b.position;
}

function stateSortKey(task: Task): SortKey {
  // No stateType at all shouldn't normally happen — every task (local or Linear) carries a
  // real stage now — but sorts before every real state as a defensive fallback rather than
  // silently landing at the bottom behind Backlog if one ever does slip through.
  if (!task.stateType) return { typeOrder: -1, position: 0 };
  return { typeOrder: STATUS_TYPE_ORDER[task.stateType] ?? 99, position: task.statePosition ?? 0 };
}

export type Section = {
  key: string;
  title: string;
  tasks: Task[];
};

// No due date sorts first, not last: a due date is what pulls a task toward the top on its
// own, so a task without one would otherwise sink to the bottom of every section and be the
// easiest thing to forget — the opposite of what's wanted for a "don't forget this" list.
function sortByDueDate(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return -1;
    if (!b.dueDate) return 1;
    return a.dueDate.localeCompare(b.dueDate);
  });
}

// Outdated and Complete are always present (even empty), mirroring todo-buddy's fixed
// sections. Everything in between is derived from the actual Linear states in use, so a
// task in "Pending" and a task in "In Progress" land in visibly separate sections instead
// of being flattened into a single "Incomplete" bucket that hides that distinction.
export function groupTasksBySection(tasks: Task[]): Section[] {
  const outdated: Task[] = [];
  const complete: Task[] = [];
  const stateGroups = new Map<string, { sortKey: SortKey; stateType?: WorkflowStateType; tasks: Task[] }>();

  for (const task of tasks) {
    const kind = classifyTask(task);
    if (kind === "hidden") continue;
    if (kind === "outdated") {
      outdated.push(task);
      continue;
    }
    if (kind === "complete") {
      complete.push(task);
      continue;
    }

    // Grouped by state *name*, not stateId: Linear duplicates each workflow state
    // per-team under the hood (every team gets its own "Backlog" with a distinct id),
    // so grouping by id produced multiple identically-named sections instead of the
    // single cross-team "Backlog" section Linear itself shows (e.g. a team's "All
    // issues" board). If two teams' same-named state ever has a different position,
    // the lower one wins so the section doesn't jump around based on which task
    // happened to be seen first.
    const key = task.stateName ?? "Unknown";
    const sortKey = stateSortKey(task);
    const existing = stateGroups.get(key);
    if (existing) {
      existing.tasks.push(task);
      if (compareSortKeys(sortKey, existing.sortKey) < 0) existing.sortKey = sortKey;
    } else {
      stateGroups.set(key, { sortKey, stateType: task.stateType, tasks: [task] });
    }
  }

  const emojiIndexByType = new Map<WorkflowStateType, number>();
  const stateSections: Section[] = [...stateGroups.entries()]
    .sort(([, a], [, b]) => compareSortKeys(a.sortKey, b.sortKey))
    .map(([name, group]) => {
      let emoji: string | undefined;
      if (!group.stateType) {
        emoji = "🆕";
      } else {
        const pool = STATUS_TYPE_EMOJI_POOL[group.stateType];
        if (pool && pool.length > 0) {
          const index = emojiIndexByType.get(group.stateType) ?? 0;
          emoji = pool[index % pool.length];
          emojiIndexByType.set(group.stateType, index + 1);
        }
      }
      return { key: name, title: emoji ? `${emoji} ${name}` : name, tasks: sortByDueDate(group.tasks) };
    });

  return [
    { key: "outdated", title: "⚠️ Outdated", tasks: sortByDueDate(outdated) },
    ...stateSections,
    { key: "complete", title: "✅ Done", tasks: sortByDueDate(complete) },
  ];
}
