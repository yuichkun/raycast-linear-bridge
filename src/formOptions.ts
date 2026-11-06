import { CachedLabel, CachedState } from "./repository/localCache";
import { Task } from "./types";

export type FormOption = { id: string; name: string };

// Edit Task's choices always include what the task already has. A dropdown or tag picker
// can only show (and submit) values that are among its items: with the task's own state or
// label missing from them, saving the form — even to change only the title — would send a
// status or label change nobody made. That's what the cached lists falling behind Linear
// (a cap on how many states were fetched, a label added since the last sync) would do.

// The team's states in workflow order, plus the task's current state if the list lacks it.
export function statusOptionsFor(task: Task, states: CachedState[]): FormOption[] {
  const options = [...states].sort((a, b) => a.position - b.position).map(({ id, name }) => ({ id, name }));
  if (task.stateId && !options.some((option) => option.id === task.stateId)) {
    options.unshift({ id: task.stateId, name: task.stateName ?? task.stateId });
  }
  return options;
}

// The team's labels, plus any of the task's current labels the list lacks.
export function labelOptionsFor(task: Task, labels: CachedLabel[]): FormOption[] {
  const options = labels.map(({ id, name }) => ({ id, name }));
  task.labelIds.forEach((id, index) => {
    if (!options.some((option) => option.id === id)) options.push({ id, name: task.labelNames[index] ?? id });
  });
  return options;
}
