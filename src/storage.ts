import { getCachedTasks, setCachedTasks } from "./repository/localCache";
import { fetchAssignedIssues } from "./repository/linearApi";
import { enqueue, getQueue, SyncOp, SyncOpField } from "./repository/syncQueue";
import { Task } from "./types";

export async function retrieveCachedItems(): Promise<Task[]> {
  return getCachedTasks();
}

export async function refreshItemsFromLinear(): Promise<Task[]> {
  const fresh = await fetchAssignedIssues();
  const cached = await getCachedTasks();
  const localOnly = cached.filter((task) => task.syncState !== "synced");
  const queue = await getQueue();
  const merged = applyPendingOpsToAll(fresh, queue);
  const combined = [...localOnly, ...merged];
  await setCachedTasks(combined);
  return combined;
}

export async function markTaskComplete(taskId: string): Promise<void> {
  const cached = await getCachedTasks();
  const task = cached.find((t) => t.id === taskId);
  if (!task || !task.doneStateId || task.stateType === "completed") return;

  const previousStateId = task.stateId;
  const updated = cached.map((t) =>
    t.id === taskId ? { ...t, stateId: task.doneStateId, stateType: "completed" as const } : t,
  );
  await setCachedTasks(updated);

  if (task.syncState === "synced") {
    await enqueue(taskId, "stateId", task.doneStateId, previousStateId);
  }
}

export async function rollbackPendingOp(op: SyncOp): Promise<void> {
  const cached = await getCachedTasks();
  const updated = cached.map((task) =>
    task.id === op.issueId ? applyOpToTask(task, op.field, op.previousValue) : task,
  );
  await setCachedTasks(updated);
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
    return pendingOps.reduce((acc, op) => applyOpToTask(acc, op.field, op.value), task);
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
