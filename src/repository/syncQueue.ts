import { LocalStorage } from "@raycast/api";
import { v4 as uuidv4 } from "uuid";
import { CreateIssueInput } from "../types";

// Field names correspond 1:1 to a single property on Task / IssueUpdateInput.
export type SyncOpField = "stateId" | "title" | "dueDate" | "priority" | "description" | "labelIds";

export type UpdateFieldOp = {
  opId: string;
  type: "updateField";
  issueId: string;
  field: SyncOpField;
  value: unknown;
  previousValue: unknown;
  createdAt: string;
};

// Archiving isn't a field update — Linear exposes it as its own mutation
// (client.archiveIssue), so it gets its own op type rather than being shoehorned into
// SyncOpField.
export type ArchiveOp = {
  opId: string;
  type: "archive";
  issueId: string;
  createdAt: string;
};

// `issueId` holds the tempId (uuid) assigned to the local-only task before Linear
// confirms creation and hands back a real issue id — kept as `issueId` (not a
// differently-named field) so getPendingOpsForIssue and other issueId-keyed lookups work
// unchanged for this op type too.
export type CreateIssueOp = {
  opId: string;
  type: "create";
  issueId: string;
  input: CreateIssueInput;
  createdAt: string;
};

export type SyncOp = UpdateFieldOp | ArchiveOp | CreateIssueOp;

const QUEUE_KEY = "syncQueue";

export async function getQueue(): Promise<SyncOp[]> {
  const raw = await LocalStorage.getItem<string>(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function setQueue(queue: SyncOp[]): Promise<void> {
  await LocalStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function enqueueFieldUpdate(
  issueId: string,
  field: SyncOpField,
  value: unknown,
  previousValue: unknown,
): Promise<void> {
  const queue = await getQueue();
  queue.push({
    opId: uuidv4(),
    type: "updateField",
    issueId,
    field,
    value,
    previousValue,
    createdAt: new Date().toISOString(),
  });
  await setQueue(queue);
}

export async function enqueueArchive(issueId: string): Promise<void> {
  const queue = await getQueue();
  queue.push({ opId: uuidv4(), type: "archive", issueId, createdAt: new Date().toISOString() });
  await setQueue(queue);
}

export async function enqueueCreate(tempId: string, input: CreateIssueInput): Promise<void> {
  const queue = await getQueue();
  queue.push({ opId: uuidv4(), type: "create", issueId: tempId, input, createdAt: new Date().toISOString() });
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
