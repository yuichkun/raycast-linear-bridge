import { v4 as uuidv4 } from "uuid";
import {
  CachedLabel,
  CachedTeam,
  getCachedTasks,
  getCachedTeamLabels,
  getCachedTeams,
  setCachedTasks,
  setCachedTeamLabels,
  setCachedTeams,
} from "./repository/localCache";
import { fetchAssignedIssues } from "./repository/linearApi";
import {
  ArchiveOp,
  enqueueArchive,
  enqueueCreate,
  enqueueFieldUpdate,
  getQueue,
  SyncOp,
  SyncOpField,
  UpdateFieldOp,
} from "./repository/syncQueue";
import { CreateIssueInput, Task } from "./types";

export async function retrieveCachedItems(): Promise<Task[]> {
  return getCachedTasks();
}

export async function retrieveLabelsForTeam(teamId: string): Promise<CachedLabel[]> {
  const teamLabels = await getCachedTeamLabels();
  return teamLabels.get(teamId) ?? [];
}

export async function retrieveTeams(): Promise<CachedTeam[]> {
  return getCachedTeams();
}

export async function refreshItemsFromLinear(): Promise<Task[]> {
  const { tasks: fresh, teamLabels, teams } = await fetchAssignedIssues();
  const cached = await getCachedTasks();
  const localOnly = cached.filter((task) => task.syncState !== "synced");
  const queue = await getQueue();
  const merged = applyPendingOpsToAll(fresh, queue);
  const combined = [...localOnly, ...merged];
  await Promise.all([setCachedTasks(combined), setCachedTeamLabels(teamLabels), setCachedTeams(teams)]);
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

export type CreateTaskInput = {
  title: string;
  saveToLinear: boolean;
  teamId?: string;
  teamName?: string;
  description?: string;
  dueDate?: string;
  priority?: number;
  labelIds?: string[];
  labelNames?: string[];
};

// Returns the tempId the task was created with locally. Callers that need to follow the
// task after it's promoted to a real Linear issue (e.g. to keep it selected) should track
// this id and watch for it disappearing from the cache — see resolveCreatedTask.
export async function createTask(input: CreateTaskInput): Promise<string> {
  const tempId = uuidv4();
  const cached = await getCachedTasks();

  const task: Task = {
    id: tempId,
    syncState: input.saveToLinear ? "pendingCreate" : "local",
    title: input.title,
    description: input.description,
    dueDate: input.dueDate,
    priority: input.priority ?? 0,
    // No real Linear state exists yet — "New" is a placeholder label so the task lands in
    // a clearly-named section instead of a stray "Unknown" one (groupTasksBySection falls
    // back to task.stateName when stateId/stateName aren't set).
    stateName: "New",
    teamId: input.teamId,
    teamName: input.teamName,
    labelIds: input.labelIds ?? [],
    labelNames: input.labelNames ?? [],
    archivedLocally: false,
  };

  await setCachedTasks([...cached, task]);

  if (input.saveToLinear && input.teamId) {
    const createInput: CreateIssueInput = {
      teamId: input.teamId,
      title: input.title,
      description: input.description,
      dueDate: input.dueDate,
      priority: input.priority,
      labelIds: input.labelIds,
    };
    await enqueueCreate(tempId, createInput);
  }

  return tempId;
}

// Promotes a local-only task to a pendingCreate one, reusing the exact same tempId ->
// real-id flow as createTask(saveToLinear: true) — from here on it's indistinguishable
// from a task that was saved to Linear from the start.
export async function promoteToLinear(taskId: string, teamId: string, teamName: string): Promise<void> {
  const cached = await getCachedTasks();
  const task = cached.find((t) => t.id === taskId);
  if (!task || task.syncState !== "local") return;

  const updated = cached.map((t) =>
    t.id === taskId ? { ...t, syncState: "pendingCreate" as const, teamId, teamName } : t,
  );
  await setCachedTasks(updated);

  const createInput: CreateIssueInput = {
    teamId,
    title: task.title,
    description: task.description,
    dueDate: task.dueDate,
    priority: task.priority,
    labelIds: task.labelIds,
  };
  await enqueueCreate(taskId, createInput);
}

// Called by processQueue once Linear confirms a CreateIssueOp: swaps the tempId for the
// real issue id and flips syncState so the task is now treated as an ordinary synced one
// (eligible for field updates/archive to actually reach Linear, included in the next
// pull's diffing, etc).
export async function resolveCreatedTask(tempId: string, realId: string): Promise<void> {
  const cached = await getCachedTasks();
  const updated = cached.map((task) =>
    task.id === tempId ? { ...task, id: realId, syncState: "synced" as const } : task,
  );
  await setCachedTasks(updated);
}

export async function rollbackPendingOp(op: SyncOp): Promise<void> {
  if (op.type === "create") {
    // Linear rejected the creation — the local-only placeholder never became real, so
    // remove it entirely instead of leaving a phantom task with no way to retry it.
    const cached = await getCachedTasks();
    await setCachedTasks(cached.filter((task) => task.id !== op.issueId));
    return;
  }

  const cached = await getCachedTasks();
  const updated = cached.map((task) => (task.id === op.issueId ? rollbackOpOnTask(task, op) : task));
  await setCachedTasks(updated);
}

function rollbackOpOnTask(task: Task, op: UpdateFieldOp | ArchiveOp): Task {
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
    // A "create" op never matches here: its issueId is a tempId that `tasks` (fetched
    // fresh from Linear) can't contain yet, so this only ever sees updateField/archive.
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
