import { LocalStorage } from "@raycast/api";
import { v4 as uuidv4 } from "uuid";

// Field names correspond 1:1 to a single property on Task / IssueUpdateInput.
export type SyncOpField = "stateId" | "title" | "dueDate" | "priority" | "description" | "labelIds";

export type SyncOp = {
  opId: string;
  issueId: string;
  field: SyncOpField;
  value: unknown;
  previousValue: unknown;
  createdAt: string;
};

const QUEUE_KEY = "syncQueue";

export async function getQueue(): Promise<SyncOp[]> {
  const raw = await LocalStorage.getItem<string>(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function setQueue(queue: SyncOp[]): Promise<void> {
  await LocalStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function enqueue(
  issueId: string,
  field: SyncOpField,
  value: unknown,
  previousValue: unknown,
): Promise<void> {
  const queue = await getQueue();
  queue.push({ opId: uuidv4(), issueId, field, value, previousValue, createdAt: new Date().toISOString() });
  await setQueue(queue);
}

export async function dequeue(opId: string): Promise<void> {
  const queue = await getQueue();
  await setQueue(queue.filter((op) => op.opId !== opId));
}

export async function getPendingOpsForIssue(issueId: string): Promise<SyncOp[]> {
  const queue = await getQueue();
  return queue.filter((op) => op.issueId === issueId);
}
