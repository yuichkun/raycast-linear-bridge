import { archiveIssue, updateIssueField } from "../repository/linearApi";
import { dequeue, getQueue, SyncOp } from "../repository/syncQueue";
import { rollbackPendingOp } from "../storage";

export type ProcessQueueResult = {
  networkUnreachable: boolean;
  failures: SyncOp[];
};

export async function processQueue(): Promise<ProcessQueueResult> {
  const queue = await getQueue();
  const failures: SyncOp[] = [];
  let networkUnreachable = false;

  for (const op of queue) {
    try {
      if (op.type === "updateField") {
        await updateIssueField(op.issueId, op.field, op.value);
      } else {
        await archiveIssue(op.issueId);
      }
      await dequeue(op.opId);
    } catch (e) {
      if (isNetworkError(e)) {
        networkUnreachable = true;
        continue;
      }
      // Linear explicitly rejected the change (e.g. validation error) — undo the optimistic
      // local update and surface it, rather than leaving the op stuck retrying forever.
      await rollbackPendingOp(op);
      await dequeue(op.opId);
      failures.push(op);
    }
  }

  return { networkUnreachable, failures };
}

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("enotfound") ||
    message.includes("econnrefused") ||
    message.includes("timeout") ||
    message.includes("timed out")
  );
}
