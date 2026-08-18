import { isPastDue } from "./date";
import { Task } from "./types";

export type TaskSection = "outdated" | "pinned" | "incomplete" | "complete";

const HIDDEN_STATE_TYPES = new Set(["canceled", "duplicate"]);

export function getTaskSection(task: Task): TaskSection | "hidden" {
  if (task.stateType && HIDDEN_STATE_TYPES.has(task.stateType)) return "hidden";
  if (task.stateType === "completed") return "complete";
  if (isPastDue(task.dueDate)) return "outdated";
  if (task.pinned) return "pinned";
  return "incomplete";
}

export function groupTasksBySection(tasks: Task[]): Record<TaskSection, Task[]> {
  const sections: Record<TaskSection, Task[]> = {
    outdated: [],
    pinned: [],
    incomplete: [],
    complete: [],
  };

  for (const task of tasks) {
    const section = getTaskSection(task);
    if (section === "hidden") continue;
    sections[section].push(task);
  }

  return sections;
}
