export function isPastDue(dueDate?: string): boolean {
  if (!dueDate) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);

  return due.getTime() < today.getTime();
}

// Mirrors todo-buddy's determinePriority: a search-friendly bucket for how soon a task
// is due, independent of Linear's own `priority` field.
export type DueUrgency = "past" | "today" | "tomorrow" | undefined;

export function determineDueUrgency(dueDate?: string): DueUrgency {
  if (!dueDate) return undefined;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);

  const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return "past";
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  return undefined;
}
