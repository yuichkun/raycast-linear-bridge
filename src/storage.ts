import { v4 as uuidv4 } from "uuid";
import {
  CachedLabel,
  CachedState,
  CachedTeam,
  getCachedTasks,
  getCachedTeamLabels,
  getCachedTeams,
  getCachedTeamStates,
  setCachedTeamLabels,
  setCachedTeams,
  setCachedTeamStates,
  updateCachedTasks,
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
  // Pending ops are laid over Linear's answer using the team metadata from that same answer,
  // so a queued state or label change shows with the names that go with it.
  const lookup: TeamMetadataLookup = { states: teamStates, labels: teamLabels };
  // The local-only tasks and pending ops are read only once the fetch is back and under the
  // lock, so a task created while Linear was answering is kept rather than overwritten.
  const { next: combined } = await updateCachedTasks(async (cached) => {
    const localOnly = cached.filter((task) => task.syncState !== "synced");
    const queue = await getQueue();
    return [...localOnly, ...applyPendingOpsToAll(fresh, queue, lookup)];
  });
  await Promise.all([setCachedTeamLabels(teamLabels), setCachedTeamStates(teamStates), setCachedTeams(teams)]);
  return combined;
}

export async function markTaskComplete(taskId: string): Promise<void> {
  await moveTaskToState(taskId, (task) => resolveMoveTarget(task, "completed"));
}

export async function markTaskInProgress(taskId: string): Promise<void> {
  await moveTaskToState(taskId, (task) => resolveMoveTarget(task, "started"));
}

// The other half of Mark as in Progress's toggle: reopening an in-progress task back to
// its team's Todo-equivalent state (or LOCAL_STAGES' "Todo" for a local-only task).
export async function markTaskTodo(taskId: string): Promise<void> {
  await moveTaskToState(taskId, (task) => resolveMoveTarget(task, "unstarted"));
}

// A state to move a task to, named the way each kind of task knows its states: a Linear
// task by the id of one of its team's states, a local-only task by the type of one of
// LOCAL_STAGES. Only that is passed in — the name, type and position that go with it are
// looked up here, so a caller can't hand over an id paired with another state's name.
export type StateChoice = { stateId: string } | { localStageType: WorkflowStateType };

// Complete/In Progress are the two most common transitions and get their own one-key
// shortcuts; this is the general-purpose escape hatch for moving to any other state a
// team has (Triage, Backlog, a custom state, or moving something back out of Done) — or,
// for a local-only task, any of the fixed LOCAL_STAGES.
export async function changeTaskState(taskId: string, choice: StateChoice): Promise<void> {
  await moveTaskToState(taskId, async (task) => {
    if ("localStageType" in choice) {
      const stage = findLocalStage(choice.localStageType);
      return stage ? { name: stage.name, type: stage.type } : undefined;
    }
    if (!task.teamId) return undefined;
    const state = (await retrieveStatesForTeam(task.teamId)).find((s) => s.id === choice.stateId);
    return state ? toStateRef(state) : undefined;
  });
}

// A task's state as one value: the id Linear knows it by (none for a local-only stage)
// together with the name, type and position shown for it. They're only ever written to a
// task together (withState) — a stateId from one state next to the name and type of another
// is a task in the wrong section, with the wrong Complete/In Progress toggle.
type StateRef = { id?: string; name: string; type: WorkflowStateType; position?: number };

function toStateRef(state: CachedState): StateRef {
  return { id: state.id, name: state.name, type: state.type as WorkflowStateType, position: state.position };
}

function withState(task: Task, state: StateRef): Task {
  return { ...task, stateId: state.id, stateName: state.name, stateType: state.type, statePosition: state.position };
}

// A task's team (if any) is the single source of truth for what "completed"/"started"
// resolve to — resolved on demand from the team's cached states rather than precomputed
// and stored on the task, so there's one place this decision is made for every caller
// (Mark as Complete/in Progress, and previously a set of fields recomputed on every full
// sync that could drift out of date between syncs). Local-only tasks have no team, so they
// use the fixed LOCAL_STAGES instead — the only thing that makes a task "local" is whether
// it exists in Linear, not whether it has a meaningful stage to move through.
async function resolveMoveTarget(task: Task, type: WorkflowStateType): Promise<StateRef | undefined> {
  if (task.syncState === "local") {
    const stage = findLocalStage(type);
    return stage ? { name: stage.name, type: stage.type } : undefined;
  }
  if (!task.teamId) return undefined;
  const states = await retrieveStatesForTeam(task.teamId);
  const target = resolveStateOfType(states, type);
  return target ? toStateRef(target) : undefined;
}

// A Linear task is in a state when it has that state's id: names aren't unique across a
// team's history (a state can be renamed, another given its old name). Local-only stages
// have no id, and each type appears in LOCAL_STAGES once.
function isInState(task: Task, target: StateRef): boolean {
  if (task.syncState === "local") return task.stateType === target.type && task.stateName === target.name;
  return task.stateId === target.id;
}

async function moveTaskToState(
  taskId: string,
  resolveTarget: (task: Task) => Promise<StateRef | undefined>,
): Promise<void> {
  const { previous, next } = await updateCachedTasks(async (cached) => {
    const task = cached.find((t) => t.id === taskId);
    if (!task) return cached;
    const target = await resolveTarget(task);
    // A missing target state means there's nothing configured for this transition (e.g. no
    // matching state resolved for the task's team) — this must surface as a failure, not a
    // silent no-op that lets the caller report success for a change that never happened.
    if (!target) {
      throw new Error(`No matching state found for "${task.title}"`);
    }
    if (task.syncState !== "local" && !target.id) {
      throw new Error(`No matching state found in Linear for "${task.title}"'s team`);
    }
    if (isInState(task, target)) return cached;

    return cached.map((t) => (t.id === task.id ? withState(t, target) : t));
  });
  if (next === previous) return;

  const task = previous.find((t) => t.id === taskId);
  const moved = next.find((t) => t.id === taskId);
  if (task?.syncState === "synced" && moved) {
    await enqueueFieldUpdate(taskId, "stateId", moved.stateId, task.stateId);
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
  const lookup = await readTeamMetadataLookup();
  const { previous, next } = await updateCachedTasks((cached) => {
    if (!cached.some((t) => t.id === taskId)) return cached;
    return cached.map((t) => (t.id === taskId ? applyOpToTask(t, field, value, lookup) : t));
  });
  if (next === previous) return;

  const task = previous.find((t) => t.id === taskId);
  if (task?.syncState === "synced") {
    await enqueueFieldUpdate(taskId, field, value, getFieldValue(task, field));
  }
}

export async function archiveTask(taskId: string): Promise<void> {
  const { previous, next } = await updateCachedTasks((cached) => {
    const task = cached.find((t) => t.id === taskId);
    if (!task || task.archivedLocally) return cached;
    // Local-only (or not-yet-created) tasks have nothing to archive on Linear's side —
    // drop them from the cache outright instead of leaving an archivedLocally=true
    // phantom that would otherwise sit there forever (no queue op will ever resolve it).
    if (task.syncState !== "synced") return cached.filter((t) => t.id !== taskId);
    return cached.map((t) => (t.id === taskId ? { ...t, archivedLocally: true } : t));
  });
  if (next === previous) return;

  if (previous.find((t) => t.id === taskId)?.syncState === "synced") {
    await enqueueArchive(taskId);
  }
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

  await updateCachedTasks((cached) => [...cached, task]);

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
export async function promoteToLinear(taskId: string, team: CachedTeam, stateId: string): Promise<void> {
  const state = (await retrieveStatesForTeam(team.id)).find((s) => s.id === stateId);
  if (!state) throw new Error(`No matching state found in Linear for ${team.name}`);

  const { previous, next } = await updateCachedTasks((cached) => {
    if (!cached.some((t) => t.id === taskId && t.syncState === "local")) return cached;
    return cached.map((t) =>
      t.id === taskId
        ? {
            ...withState(t, toStateRef(state)),
            syncState: "pendingCreate" as const,
            teamId: team.id,
            teamName: team.name,
          }
        : t,
    );
  });
  const task = previous.find((t) => t.id === taskId);
  if (next === previous || !task) return;

  const createInput: CreateIssueInput = {
    teamId: team.id,
    title: task.title,
    description: task.description,
    dueDate: task.dueDate,
    priority: task.priority,
    stateId: state.id,
    labelIds: task.labelIds,
  };
  await enqueueCreate(taskId, createInput);
}

// Called by processQueue once Linear confirms a CreateIssueOp: swaps the tempId for the
// real issue id and flips syncState so the task is now treated as an ordinary synced one
// (eligible for field updates/archive to actually reach Linear, included in the next
// pull's diffing, etc).
export async function resolveCreatedTask(tempId: string, realId: string): Promise<void> {
  await updateCachedTasks((cached) =>
    cached.map((task) => (task.id === tempId ? { ...task, id: realId, syncState: "synced" as const } : task)),
  );
}

export async function rollbackPendingOp(op: SyncOp): Promise<void> {
  if (op.type === "create") {
    // Linear rejected the creation — the local-only placeholder never became real, so
    // remove it entirely instead of leaving a phantom task with no way to retry it.
    await updateCachedTasks((cached) => cached.filter((task) => task.id !== op.issueId));
    return;
  }

  if (op.type === "createComment") {
    // Nothing optimistic was written to the cache for a comment; the queued text is
    // dropped here and reported by the Sync command's toast.
    return;
  }

  const lookup = await readTeamMetadataLookup();
  await updateCachedTasks((cached) =>
    cached.map((task) => (task.id === op.issueId ? rollbackOpOnTask(task, op, lookup) : task)),
  );
}

function rollbackOpOnTask(task: Task, op: UpdateFieldOp | ArchiveOp, lookup: TeamMetadataLookup): Task {
  if (op.type === "updateField") return applyOpToTask(task, op.field, op.previousValue, lookup);
  return { ...task, archivedLocally: false };
}

// The cached team states and labels — what a state id or label id on a task stands for.
type TeamMetadataLookup = {
  states: Map<string, CachedState[]>;
  labels: Map<string, CachedLabel[]>;
};

async function readTeamMetadataLookup(): Promise<TeamMetadataLookup> {
  const [states, labels] = await Promise.all([getCachedTeamStates(), getCachedTeamLabels()]);
  return { states, labels };
}

function applyPendingOpsToAll(tasks: Task[], queue: SyncOp[], lookup: TeamMetadataLookup): Task[] {
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
      if (op.type === "updateField") return applyOpToTask(acc, op.field, op.value, lookup);
      if (op.type === "archive") return { ...acc, archivedLocally: true };
      // A "create" op never matches here (its issueId is a tempId that `tasks`, fetched
      // fresh from Linear, can't contain yet), and a pending comment changes nothing on
      // the task itself — it must not fall through into the archive branch.
      return acc;
    }, task);
  });
}

// An op stores only what Linear is sent — a state id, label ids. Applying one (optimistically,
// as a rollback, or over a fresh pull) has to bring along what the task shows for those ids,
// or the task keeps the old state's name and type, or the old labels' names, next to the new
// ids until the next pull.
function applyOpToTask(task: Task, field: SyncOpField, value: unknown, lookup: TeamMetadataLookup): Task {
  switch (field) {
    case "stateId": {
      const state = task.teamId ? lookup.states.get(task.teamId)?.find((s) => s.id === value) : undefined;
      // An id the team's states don't have (deleted in Linear since, say) leaves the task as
      // it is instead of pairing that id with another state's name and type. The pull that
      // follows every push says where the issue really is.
      return state ? withState(task, toStateRef(state)) : task;
    }
    case "title":
      return { ...task, title: value as string };
    case "dueDate":
      return { ...task, dueDate: value as string | undefined };
    case "priority":
      return { ...task, priority: value as number };
    case "description":
      return { ...task, description: value as string | undefined };
    case "labelIds": {
      const labelIds = value as string[];
      return { ...task, labelIds, labelNames: labelNamesFor(task, labelIds, lookup) };
    }
  }
}

// Names for label ids: the team's labels, plus the task's own current ones for an id the
// team's list doesn't have (a label newer than the cache, say), so a label the task already
// carries never loses its name. labelNames stays index-aligned with labelIds; an id with no
// name anywhere shows as the id until the next pull brings its name.
function labelNamesFor(task: Task, labelIds: string[], lookup: TeamMetadataLookup): string[] {
  const names = new Map<string, string>();
  task.labelIds.forEach((id, index) => {
    const name = task.labelNames[index];
    if (name !== undefined) names.set(id, name);
  });
  for (const label of (task.teamId && lookup.labels.get(task.teamId)) || []) names.set(label.id, label.name);
  return labelIds.map((id) => names.get(id) ?? id);
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
