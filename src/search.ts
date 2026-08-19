import Fuse from "fuse.js";
import { PRIORITY_NAMES } from "./constants";
import { determineDueUrgency } from "./date";
import { Task } from "./types";

type SearchTarget = Task & {
  dueDateFormatted?: string;
  urgency?: string;
  hasNoLabel: string;
  priorityName: string;
  syncLabel: string;
};

export function searchItems(unfilteredItems: Task[], searchText: string): Task[] {
  const searchTargets: SearchTarget[] = unfilteredItems.map((task) => ({
    ...task,
    dueDateFormatted: task.dueDate ? new Date(task.dueDate).toLocaleDateString() : undefined,
    urgency: determineDueUrgency(task.dueDate),
    hasNoLabel: task.labelNames.length === 0 ? "no label" : "",
    priorityName: PRIORITY_NAMES[task.priority] ?? "No priority",
    // Lets "local" in the search bar filter down to local-only tasks, the same way "today"
    // already filters by due-date urgency.
    syncLabel: task.syncState === "local" ? "local only" : "",
  }));

  const fuse = new Fuse(searchTargets, {
    keys: [
      "title",
      "labelNames",
      "stateName",
      "teamName",
      "dueDateFormatted",
      "urgency",
      "hasNoLabel",
      "priorityName",
      "syncLabel",
    ],
    useExtendedSearch: true,
    threshold: 0.2,
  });

  const result = fuse.search(searchText);
  const matchingIds = new Set(result.map((r) => r.item.id));
  return unfilteredItems.filter((item) => matchingIds.has(item.id));
}
