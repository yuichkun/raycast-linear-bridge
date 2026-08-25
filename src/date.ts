// Linear's dueDate is a date-only value (YYYY-MM-DD). Deliberately avoids
// Date#toISOString() here: it converts to UTC first, so picking a date late in the day in
// a timezone ahead of UTC would silently roll over to the previous day.
export function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// How far ahead the list looks: tasks due after the horizon's last day are hidden. Week is
// Monday–Sunday and month is the calendar month — matching how deadlines actually get
// phrased ("今週中", "今月中") rather than a rolling N-day window, and matching this
// workspace's month-end/month-start billing rhythm.
export type DueHorizon = "all" | "today" | "week" | "month";

export const DUE_HORIZONS: DueHorizon[] = ["all", "today", "week", "month"];

// Anything unrecognized (a stale persisted value, say) falls back to showing everything —
// the safe failure mode for a filter is to not filter.
export function parseDueHorizon(value: string | undefined): DueHorizon {
  return DUE_HORIZONS.includes(value as DueHorizon) ? (value as DueHorizon) : "all";
}

// Last calendar day (YYYY-MM-DD) a task may be due and still fall inside the horizon, or
// undefined for "all".
export function dueHorizonEnd(horizon: DueHorizon, now: Date = new Date()): string | undefined {
  switch (horizon) {
    case "all":
      return undefined;
    case "today":
      return formatDateOnly(now);
    case "week": {
      // getDay(): 0 = Sunday … 6 = Saturday. Sunday closes the week, so it maps to 0 days ahead.
      const end = new Date(now);
      end.setDate(end.getDate() + ((7 - end.getDay()) % 7));
      return formatDateOnly(end);
    }
    case "month":
      // Day 0 of the next month is the last day of this one.
      return formatDateOnly(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  }
}

// No due date always passes: keeping undated tasks visible under every horizon is
// deliberate — it's what nudges them toward getting a date, instead of letting them hide
// behind a "just today" view. Overdue tasks pass too (a past date is never after the
// horizon). Compared as YYYY-MM-DD strings so timezones can't shift a day.
export function isDueWithinHorizon(dueDate: string | undefined, horizonEnd: string | undefined): boolean {
  if (!horizonEnd || !dueDate) return true;
  return dueDate <= horizonEnd;
}

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
