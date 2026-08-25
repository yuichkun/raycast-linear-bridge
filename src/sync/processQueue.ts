import { archiveIssue, createComment, createIssue, updateIssueField } from "../repository/linearApi";
import { isNetworkError } from "../repository/networkError";
import { dequeue, getQueue, SyncOp } from "../repository/syncQueue";
import { resolveCreatedTask, rollbackPendingOp } from "../storage";

export type ProcessQueueResult = {
  networkUnreachable: boolean;
  failures: SyncOp[];
};

let inFlight: Promise<ProcessQueueResult> | undefined;
let followUp: Promise<ProcessQueueResult> | undefined;

// Runs never overlap within a process. Two concurrent runs would both read the queue
// before either dequeued anything and both send the same op — for a create, that's a
// duplicate issue. Overlap is the normal case, not an edge case: sync is kicked from
// List Tasks' mount, from every action's refetchList, and from the interval Sync command.
//
// A kick that arrives mid-run doesn't just join the running one — something may have
// been enqueued after that run read the queue — so exactly one follow-up run is chained
// behind it. Callers that kick during the run share that follow-up. This covers a single
// process; the per-op idempotency ids in linearApi.ts cover everything else (separate
// processes, a process torn down between send and dequeue).
export function processQueue(): Promise<ProcessQueueResult> {
  if (!inFlight) {
    inFlight = runQueue().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  }
  if (!followUp) {
    followUp = inFlight
      .catch(() => undefined)
      .then(() => {
        followUp = undefined;
        return processQueue();
      });
  }
  return followUp;
}

async function runQueue(): Promise<ProcessQueueResult> {
  const queue = await getQueue();
  const failures: SyncOp[] = [];
  let networkUnreachable = false;

  for (const op of queue) {
    try {
      switch (op.type) {
        case "updateField":
          await updateIssueField(op.issueId, op.field, op.value);
          break;
        case "archive":
          await archiveIssue(op.issueId);
          break;
        case "create": {
          const realId = await createIssue(op.issueId, op.input);
          await resolveCreatedTask(op.issueId, realId);
          break;
        }
        case "createComment":
          await createComment(op.opId, op.issueId, op.body);
          break;
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
