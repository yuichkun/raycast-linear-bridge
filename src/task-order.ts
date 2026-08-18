import { isPastDue } from "./date";
import { Task, WorkflowStateType } from "./types";

const HIDDEN_STATE_TYPES = new Set<WorkflowStateType>(["canceled", "duplicate"]);

// Natural progression of a Linear workflow state, used to order the dynamic per-state
// sections. "completed" and "canceled"/"duplicate" are handled as their own fixed
// sections (Complete / hidden) and never appear here.
const STATUS_TYPE_ORDER: Partial<Record<WorkflowStateType, number>> = {
  triage: 0,
  backlog: 1,
  unstarted: 2,
  started: 3,
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
  const stateGroups = new Map<string, { sortKey: number; title: string; tasks: Task[] }>();

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

    const key = task.stateId ?? "unknown";
    const existing = stateGroups.get(key);
    if (existing) {
      existing.tasks.push(task);
    } else {
      stateGroups.set(key, {
        sortKey: stateSortKey(task),
        title: task.stateName ?? "Unknown",
        tasks: [task],
      });
    }
  }

  const stateSections: Section[] = [...stateGroups.entries()]
    .sort(([, a], [, b]) => a.sortKey - b.sortKey)
    .map(([stateId, group]) => ({ key: stateId, title: group.title, tasks: group.tasks }));

  return [
    { key: "outdated", title: "⚠️ Outdated", tasks: outdated },
    ...stateSections,
    { key: "complete", title: "✅ Done", tasks: complete },
  ];
}
