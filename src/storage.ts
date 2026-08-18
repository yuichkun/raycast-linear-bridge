import {
  CachedLabel,
  getCachedTasks,
  getCachedTeamLabels,
  setCachedTasks,
  setCachedTeamLabels,
} from "./repository/localCache";
import { fetchAssignedIssues } from "./repository/linearApi";
import { enqueueArchive, enqueueFieldUpdate, getQueue, SyncOp, SyncOpField } from "./repository/syncQueue";
import { Task } from "./types";

export async function retrieveCachedItems(): Promise<Task[]> {
  return getCachedTasks();
}

export async function retrieveLabelsForTeam(teamId: string): Promise<CachedLabel[]> {
  const teamLabels = await getCachedTeamLabels();
  return teamLabels.get(teamId) ?? [];
}

export async function refreshItemsFromLinear(): Promise<Task[]> {
  const { tasks: fresh, teamLabels } = await fetchAssignedIssues();
  const cached = await getCachedTasks();
  const localOnly = cached.filter((task) => task.syncState !== "synced");
  const queue = await getQueue();
  const merged = applyPendingOpsToAll(fresh, queue);
  const combined = [...localOnly, ...merged];
  await Promise.all([setCachedTasks(combined), setCachedTeamLabels(teamLabels)]);
  return combined;
}

export async function markTaskComplete(taskId: string): Promise<void> {
  const cached = await getCachedTasks();
  const task = cached.find((t) => t.id === taskId);
  if (!task) return;
  await moveTaskToState(cached, task, task.doneStateId, task.doneStateName, "completed");
}

export async function markTaskInProgress(taskId: string): Promise<void> {
  const cached = await getCachedTasks();
  const task = cached.find((t) => t.id === taskId);
  if (!task) return;
  await moveTaskToState(cached, task, task.startStateId, task.startStateName, task.startStateType);
}

async function moveTaskToState(
  cached: Task[],
  task: Task,
  targetStateId: string | undefined,
  targetStateName: string | undefined,
  targetStateType: Task["stateType"],
): Promise<void> {
  if (!targetStateId || task.stateId === targetStateId) return;

  const previousStateId = task.stateId;
  const updated = cached.map((t) =>
    t.id === task.id ? { ...t, stateId: targetStateId, stateName: targetStateName, stateType: targetStateType } : t,
  );
  await setCachedTasks(updated);

  if (task.syncState === "synced") {
    await enqueueFieldUpdate(task.id, "stateId", targetStateId, previousStateId);
  }
}

export async function renameTask(taskId: string, title: string): Promise<void> {
  await updateTaskField(taskId, "title", title);
}

export async function updateDueDate(taskId: string, dueDate: string | undefined): Promise<void> {
  await updateTaskField(taskId, "dueDate", dueDate);
}

export async function updatePriority(taskId: string, priority: number): Promise<void> {
  await updateTaskField(taskId, "priority", priority);
}

export async function updateLabels(taskId: string, labelIds: string[]): Promise<void> {
  await updateTaskField(taskId, "labelIds", labelIds);
}

export async function updateDescription(taskId: string, description: string | undefined): Promise<void> {
  await updateTaskField(taskId, "description", description);
}

async function updateTaskField(taskId: string, field: SyncOpField, value: unknown): Promise<void> {
  const cached = await getCachedTasks();
  const task = cached.find((t) => t.id === taskId);
  if (!task) return;

  const previousValue = getFieldValue(task, field);
  const updated = cached.map((t) => (t.id === taskId ? applyOpToTask(t, field, value) : t));
  await setCachedTasks(updated);

  if (task.syncState === "synced") {
    await enqueueFieldUpdate(taskId, field, value, previousValue);
  }
}

export async function archiveTask(taskId: string): Promise<void> {
  const cached = await getCachedTasks();
  const task = cached.find((t) => t.id === taskId);
  if (!task || task.archivedLocally) return;

  const updated = cached.map((t) => (t.id === taskId ? { ...t, archivedLocally: true } : t));
  await setCachedTasks(updated);

  if (task.syncState === "synced") {
    await enqueueArchive(taskId);
  }
}

export async function rollbackPendingOp(op: SyncOp): Promise<void> {
  const cached = await getCachedTasks();
  const updated = cached.map((task) => (task.id === op.issueId ? rollbackOpOnTask(task, op) : task));
  await setCachedTasks(updated);
}

function rollbackOpOnTask(task: Task, op: SyncOp): Task {
  if (op.type === "updateField") return applyOpToTask(task, op.field, op.previousValue);
  return { ...task, archivedLocally: false };
}

function applyPendingOpsToAll(tasks: Task[], queue: SyncOp[]): Task[] {
  if (queue.length === 0) return tasks;

  const pendingByIssue = new Map<string, SyncOp[]>();
  for (const op of queue) {
    const ops = pendingByIssue.get(op.issueId) ?? [];
    ops.push(op);
    pendingByIssue.set(op.issueId, ops);
  }

  return tasks.map((task) => {
    const pendingOps = pendingByIssue.get(task.id);
    if (!pendingOps) return task;
    return pendingOps.reduce(
      (acc, op) =>
        op.type === "updateField" ? applyOpToTask(acc, op.field, op.value) : { ...acc, archivedLocally: true },
      task,
    );
  });
}

function applyOpToTask(task: Task, field: SyncOpField, value: unknown): Task {
  switch (field) {
    case "stateId":
      return { ...task, stateId: value as string };
    case "title":
      return { ...task, title: value as string };
    case "dueDate":
      return { ...task, dueDate: value as string | undefined };
    case "priority":
      return { ...task, priority: value as number };
    case "description":
      return { ...task, description: value as string | undefined };
    case "labelIds":
      return { ...task, labelIds: value as string[] };
  }
}

function getFieldValue(task: Task, field: SyncOpField): unknown {
  switch (field) {
    case "stateId":
      return task.stateId;
    case "title":
      return task.title;
    case "dueDate":
      return task.dueDate;
    case "priority":
      return task.priority;
    case "description":
      return task.description;
    case "labelIds":
      return task.labelIds;
  }
}
