import { isPastDue } from "./date";
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

export type SectionKind = "outdated" | "complete" | "hidden" | "state";

export function classifyTask(task: Task): SectionKind {
  if (task.stateType && HIDDEN_STATE_TYPES.has(task.stateType)) return "hidden";
  if (task.stateType === "completed") return "complete";
  if (isPastDue(task.dueDate)) return "outdated";
  return "state";
}

function stateSortKey(task: Task): number {
  const typeOrder = task.stateType ? (STATUS_TYPE_ORDER[task.stateType] ?? 99) : 99;
  const position = task.statePosition ?? 0;
  return typeOrder * 1_000_000 + position;
}

export type Section = {
  key: string;
  title: string;
  tasks: Task[];
};

// Outdated and Complete are always present (even empty), mirroring todo-buddy's fixed
// sections. Everything in between is derived from the actual Linear states in use, so a
// task in "Pending" and a task in "In Progress" land in visibly separate sections instead
// of being flattened into a single "Incomplete" bucket that hides that distinction.
export function groupTasksBySection(tasks: Task[]): Section[] {
  const outdated: Task[] = [];
  const complete: Task[] = [];
  const stateGroups = new Map<string, { sortKey: number; tasks: Task[] }>();

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
      existing.sortKey = Math.min(existing.sortKey, sortKey);
    } else {
      stateGroups.set(key, { sortKey, tasks: [task] });
    }
  }

  const stateSections: Section[] = [...stateGroups.entries()]
    .sort(([, a], [, b]) => a.sortKey - b.sortKey)
    .map(([name, group]) => ({ key: name, title: name, tasks: group.tasks }));

  return [
    { key: "outdated", title: "⚠️ Outdated", tasks: outdated },
    ...stateSections,
    { key: "complete", title: "✅ Done", tasks: complete },
  ];
}
