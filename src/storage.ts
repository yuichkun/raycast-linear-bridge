import { v4 as uuidv4 } from "uuid";
import {
  CachedLabel,
  CachedState,
  CachedTeam,
  getCachedTasks,
  getCachedTeamLabels,
  getCachedTeams,
  getCachedTeamStates,
  setCachedTasks,
  setCachedTeamLabels,
  setCachedTeams,
  setCachedTeamStates,
} from "./repository/localCache";
import { findLocalStage } from "./localStages";
import { fetchAssignedIssues, fetchIssueComments, resolveStateOfType } from "./repository/linearApi";
import { getDueHorizon, getVisibleTeamIds, setDueHorizon, setVisibleTeamIds } from "./repository/settings";
import { DueHorizon } from "./date";
import {
  ArchiveOp,
  CreateCommentOp,
  enqueueArchive,
  enqueueComment,
  enqueueCreate,
  enqueueFieldUpdate,
  getPendingOpsForIssue,
  getQueue,
  SyncOp,
  SyncOpField,
  UpdateFieldOp,
} from "./repository/syncQueue";
import { CreateIssueInput, IssueComment, Task, WorkflowStateType } from "./types";

export async function retrieveCachedItems(): Promise<Task[]> {
  return getCachedTasks();
}

export async function retrieveLabelsForTeam(teamId: string): Promise<CachedLabel[]> {
  const teamLabels = await getCachedTeamLabels();
  return teamLabels.get(teamId) ?? [];
}

export async function retrieveStatesForTeam(teamId: string): Promise<CachedState[]> {
  const teamStates = await getCachedTeamStates();
  return teamStates.get(teamId) ?? [];
}

export async function retrieveTeams(): Promise<CachedTeam[]> {
  return getCachedTeams();
}

// The visible-teams setting is a display-level filter only: sync always fetches and
// pushes every team's issues regardless (the cache stays complete, so widening the filter
// is instant and works offline), and Create Task / Promote to Linear offer every team as
// a target. An empty selection means no filtering.
export async function retrieveVisibleTeamIds(): Promise<string[]> {
  return getVisibleTeamIds();
}

export async function updateVisibleTeamIds(teamIds: string[]): Promise<void> {
  await setVisibleTeamIds(teamIds);
}

// Same display-level nature as the team filter: only List Tasks' view changes.
export async function retrieveDueHorizon(): Promise<DueHorizon> {
  return getDueHorizon();
}

export async function updateDueHorizon(horizon: DueHorizon): Promise<void> {
  await setDueHorizon(horizon);
}

// Comments are read live rather than cached: they're only needed while a task's detail
// view is open, and one request per open (author identities nested in) is cheap.
export async function fetchCommentsForTask(taskId: string): Promise<IssueComment[]> {
  return fetchIssueComments(taskId);
}

// Comments are only offered on synced tasks: a local-only task has no Linear issue to
// attach one to, and a pendingCreate task's id is still a tempId that a comment op can't
// resolve. The queue carries the comment to Linear; nothing changes in the tasks cache,
// so there's nothing to roll back if Linear rejects it — that failure surfaces through
// the Sync command's toast instead.
export async function addComment(taskId: string, body: string): Promise<void> {
  const cached = await getCachedTasks();
  const task = cached.find((t) => t.id === taskId);
  if (!task) throw new Error("Task not found");
  if (task.syncState !== "synced") {
    throw new Error(`"${task.title}" isn't in Linear yet, so it can't take comments`);
  }
  await enqueueComment(taskId, body);
}

// Queued-but-unsent comments, so the detail view can show what was just written instead
// of making it look lost until the next sync goes through.
export async function retrievePendingCommentsForTask(taskId: string): Promise<IssueComment[]> {
  const ops = await getPendingOpsForIssue(taskId);
  return ops
    .filter((op): op is CreateCommentOp => op.type === "createComment")
    .map((op) => ({
      id: op.opId,
      body: op.body,
      createdAt: op.createdAt,
      authorName: "You",
      reactions: [],
      pending: true,
    }));
}

export async function refreshItemsFromLinear(): Promise<Task[]> {
  const { tasks: fresh, teamLabels, teamStates, teams } = await fetchAssignedIssues();
  const cached = await getCachedTasks();
  const localOnly = cached.filter((task) => task.syncState !== "synced");
  const queue = await getQueue();
  const merged = applyPendingOpsToAll(fresh, queue);
  const combined = [...localOnly, ...merged];
  await Promise.all([
    setCachedTasks(combined),
    setCachedTeamLabels(teamLabels),
    setCachedTeamStates(teamStates),
    setCachedTeams(teams),
  ]);
  return combined;
}

export async function markTaskComplete(taskId: string): Promise<void> {
  const cached = await getCachedTasks();
  const task = cached.find((t) => t.id === taskId);
  if (!task) return;
  const target = await resolveMoveTarget(task, "completed");
  await moveTaskToState(cached, task, target);
}

export async function markTaskInProgress(taskId: string): Promise<void> {
  const cached = await getCachedTasks();
  const task = cached.find((t) => t.id === taskId);
  if (!task) return;
  const target = await resolveMoveTarget(task, "started");
  await moveTaskToState(cached, task, target);
}

// The other half of Mark as in Progress's toggle: reopening an in-progress task back to
// its team's Todo-equivalent state (or LOCAL_STAGES' "Todo" for a local-only task).
export async function markTaskTodo(taskId: string): Promise<void> {
  const cached = await getCachedTasks();
  const task = cached.find((t) => t.id === taskId);
  if (!task) return;
  const target = await resolveMoveTarget(task, "unstarted");
  await moveTaskToState(cached, task, target);
}

// Complete/In Progress are the two most common transitions and get their own one-key
// shortcuts; this is the general-purpose escape hatch for moving to any other state a
// team has (Triage, Backlog, a custom state, or moving something back out of Done) — or,
// for a local-only task, any of the fixed LOCAL_STAGES.
export async function changeTaskState(
  taskId: string,
  targetStateId: string | undefined,
  targetStateName: string,
  targetStateType: WorkflowStateType,
): Promise<void> {
  const cached = await getCachedTasks();
  const task = cached.find((t) => t.id === taskId);
  if (!task) return;
  await moveTaskToState(cached, task, { id: targetStateId, name: targetStateName, type: targetStateType });
}

type MoveTarget = { id?: string; name: string; type: WorkflowStateType };

// A task's team (if any) is the single source of truth for what "completed"/"started"
// resolve to — resolved on demand from the team's cached states rather than precomputed
// and stored on the task, so there's one place this decision is made for every caller
// (Mark as Complete/in Progress, and previously a set of fields recomputed on every full
// sync that could drift out of date between syncs). Local-only tasks have no team, so they
// use the fixed LOCAL_STAGES instead — the only thing that makes a task "local" is whether
// it exists in Linear, not whether it has a meaningful stage to move through.
async function resolveMoveTarget(task: Task, type: WorkflowStateType): Promise<MoveTarget | undefined> {
  if (task.syncState === "local") {
    const stage = findLocalStage(type);
    return stage ? { name: stage.name, type: stage.type } : undefined;
  }
  if (!task.teamId) return undefined;
  const states = await retrieveStatesForTeam(task.teamId);
  const target = resolveStateOfType(states, type);
  return target ? { id: target.id, name: target.name, type: target.type as WorkflowStateType } : undefined;
}

async function moveTaskToState(cached: Task[], task: Task, target: MoveTarget | undefined): Promise<void> {
  // A missing target state means there's nothing configured for this transition (e.g. no
  // matching state resolved for the task's team) — this must surface as a failure, not a
  // silent no-op that lets the caller report success for a change that never happened.
  if (!target) {
    throw new Error(`No matching state found for "${task.title}"`);
  }
  if (task.syncState !== "local" && !target.id) {
    throw new Error(`No matching state found in Linear for "${task.title}"'s team`);
  }
  if (task.stateName === target.name && task.stateType === target.type) return;

  const previousStateId = task.stateId;
  const updated = cached.map((t) =>
    t.id === task.id ? { ...t, stateId: target.id, stateName: target.name, stateType: target.type } : t,
  );
  await setCachedTasks(updated);

  if (task.syncState === "synced") {
    await enqueueFieldUpdate(task.id, "stateId", target.id, previousStateId);
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

  if (task.syncState !== "synced") {
    // Local-only (or not-yet-created) tasks have nothing to archive on Linear's side —
    // drop them from the cache outright instead of leaving an archivedLocally=true
    // phantom that would otherwise sit there forever (no queue op will ever resolve it).
    await setCachedTasks(cached.filter((t) => t.id !== taskId));
    return;
  }

  const updated = cached.map((t) => (t.id === taskId ? { ...t, archivedLocally: true } : t));
  await setCachedTasks(updated);
  await enqueueArchive(taskId);
}

export async function archiveCompletedTasks(): Promise<number> {
  const cached = await getCachedTasks();
  const completedTasks = cached.filter((task) => task.stateType === "completed" && !task.archivedLocally);
  for (const task of completedTasks) {
    await archiveTask(task.id);
  }
  return completedTasks.length;
}

export type CreateTaskInput = {
  title: string;
  saveToLinear: boolean;
  teamId?: string;
  teamName?: string;
  stateId?: string;
  stateName?: string;
  stateType?: Task["stateType"];
  statePosition?: number;
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
    // Local-only and Linear tasks alike always carry a real stage picked in the Create
    // Task form (LOCAL_STAGES for local-only, the team's real states for Save to Linear) —
    // "New" is only an ultimate fallback, not the normal case.
    stateId: input.stateId,
    stateName: input.stateName ?? "New",
    stateType: input.stateType,
    statePosition: input.statePosition,
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
      stateId: input.stateId,
      labelIds: input.labelIds,
    };
    await enqueueCreate(tempId, createInput);
  }

  return tempId;
}

// Promotes a local-only task to a pendingCreate one, reusing the exact same tempId ->
// real-id flow as createTask(saveToLinear: true) — from here on it's indistinguishable
// from a task that was saved to Linear from the start.
export async function promoteToLinear(
  taskId: string,
  teamId: string,
  teamName: string,
  stateId: string,
  stateName: string,
  stateType: Task["stateType"],
): Promise<void> {
  const cached = await getCachedTasks();
  const task = cached.find((t) => t.id === taskId);
  if (!task || task.syncState !== "local") return;

  const updated = cached.map((t) =>
    t.id === taskId
      ? { ...t, syncState: "pendingCreate" as const, teamId, teamName, stateId, stateName, stateType }
      : t,
  );
  await setCachedTasks(updated);

  const createInput: CreateIssueInput = {
    teamId,
    title: task.title,
    description: task.description,
    dueDate: task.dueDate,
    priority: task.priority,
    stateId,
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

  if (op.type === "createComment") {
    // Nothing optimistic was written to the cache for a comment; the queued text is
    // dropped here and reported by the Sync command's toast.
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
    return pendingOps.reduce((acc, op) => {
      if (op.type === "updateField") return applyOpToTask(acc, op.field, op.value);
      if (op.type === "archive") return { ...acc, archivedLocally: true };
      // A "create" op never matches here (its issueId is a tempId that `tasks`, fetched
      // fresh from Linear, can't contain yet), and a pending comment changes nothing on
      // the task itself — it must not fall through into the archive branch.
      return acc;
    }, task);
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
