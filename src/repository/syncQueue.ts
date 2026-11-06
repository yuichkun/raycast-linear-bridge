import { v4 as uuidv4 } from "uuid";
import { readJsonFile, updateJsonFile } from "./fileStore";
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

// A comment is a new object on Linear's side rather than a field of the issue, so like
// archive/create it gets its own op. `issueId` is always a real issue id here: comments
// are only offered on synced tasks, so there's never a tempId to resolve first.
export type CreateCommentOp = {
  opId: string;
  type: "createComment";
  issueId: string;
  body: string;
  createdAt: string;
};

export type SyncOp = UpdateFieldOp | ArchiveOp | CreateIssueOp | CreateCommentOp;

// Pending ops are irreplaceable the same way local-only tasks are: losing a queued create/
// update/archive silently means "I did this but Linear never found out" — so this lives in
// environment.supportPath rather than LocalStorage too. See fileStore.ts and
// localCache.ts's tasks cache for the full reasoning.
const QUEUE_FILE = "syncQueue.json";
const QUEUE_LEGACY_KEY = "syncQueue";

export async function getQueue(): Promise<SyncOp[]> {
  return readJsonFile<SyncOp[]>(QUEUE_FILE, [], QUEUE_LEGACY_KEY);
}

// Under the file lock (see fileStore.ts's updateJsonFile): an enqueue from List Tasks and a
// dequeue from the scheduled Sync command could otherwise each write back a queue missing
// the other's change, dropping a queued op or bringing back one that was already sent.
async function updateQueue(update: (queue: SyncOp[]) => SyncOp[]): Promise<void> {
  await updateJsonFile<SyncOp[]>(QUEUE_FILE, [], update, QUEUE_LEGACY_KEY);
}

export async function enqueueFieldUpdate(
  issueId: string,
  field: SyncOpField,
  value: unknown,
  previousValue: unknown,
): Promise<void> {
  const op: UpdateFieldOp = {
    opId: uuidv4(),
    type: "updateField",
    issueId,
    field,
    value,
    previousValue,
    createdAt: new Date().toISOString(),
  };
  await updateQueue((queue) => [...queue, op]);
}

export async function enqueueArchive(issueId: string): Promise<void> {
  const op: ArchiveOp = { opId: uuidv4(), type: "archive", issueId, createdAt: new Date().toISOString() };
  await updateQueue((queue) => [...queue, op]);
}

export async function enqueueCreate(tempId: string, input: CreateIssueInput): Promise<void> {
  const op: CreateIssueOp = {
    opId: uuidv4(),
    type: "create",
    issueId: tempId,
    input,
    createdAt: new Date().toISOString(),
  };
  await updateQueue((queue) => [...queue, op]);
}

export async function enqueueComment(issueId: string, body: string): Promise<void> {
  const op: CreateCommentOp = {
    opId: uuidv4(),
    type: "createComment",
    issueId,
    body,
    createdAt: new Date().toISOString(),
  };
  await updateQueue((queue) => [...queue, op]);
}

export async function dequeue(opId: string): Promise<void> {
  await updateQueue((queue) => queue.filter((op) => op.opId !== opId));
}

// Every op for one issue at once — for when the issue itself is never going to exist.
export async function dequeueAllForIssue(issueId: string): Promise<void> {
  await updateQueue((queue) => queue.filter((op) => op.issueId !== issueId));
}

export async function getPendingOpsForIssue(issueId: string): Promise<SyncOp[]> {
  const queue = await getQueue();
  return queue.filter((op) => op.issueId === issueId);
}
