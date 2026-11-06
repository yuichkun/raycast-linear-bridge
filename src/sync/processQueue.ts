import { archiveIssue, createComment, createIssue, updateIssueField } from "../repository/linearApi";
import { isLinearUnreachable, shouldRetryLater } from "../repository/linearErrors";
import { dequeue, dequeueAllForIssue, getQueue, SyncOp } from "../repository/syncQueue";
import { resolveCreatedTask, rollbackPendingOp } from "../storage";

export type ProcessQueueResult = {
  networkUnreachable: boolean;
  // Rejected by Linear and rolled back.
  failures: SyncOp[];
  // Left queued because Linear answered without judging them (rate limited, failing on its
  // side, ...), or because an earlier op for the same issue was. Sent again on the next run.
  deferred: number;
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
  let deferred = 0;
  // Issues whose create Linear rejected in this run. Their later ops were queued against an
  // issue that will never exist, and were dropped along with it — see below.
  const abandoned = new Set<string>();
  // Issues with an op left queued in this run. Their later ops wait too: sent past it, they'd
  // reach Linear out of order — a "Done" sent ahead of an earlier "In Progress" that goes
  // through next time leaves the issue In Progress. Other issues' ops carry on, so one op
  // Linear keeps failing on holds up only its own issue.
  const held = new Set<string>();

  for (const op of queue) {
    if (abandoned.has(op.issueId)) continue;
    if (held.has(op.issueId)) {
      deferred++;
      continue;
    }
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
      // No answer from Linear: nothing else in the queue can get through either, and all of
      // it stays queued for the next run.
      if (isLinearUnreachable(e)) {
        networkUnreachable = true;
        break;
      }
      // Linear answered without judging the change (rate limited, failing on its side, not
      // accepting the key right now): it stays queued and is sent again on the next run.
      if (shouldRetryLater(e)) {
        held.add(op.issueId);
        deferred++;
        continue;
      }
      // Linear looked at the change and refused it (e.g. a validation error) — undo the
      // optimistic local update and surface it, rather than leaving it retrying forever.
      await rollbackPendingOp(op);
      if (op.type === "create") {
        // Edits made to the task while it waited to be created were queued against the
        // issue's id-to-be. With no issue coming, they can only fail the same way, and
        // rolling each back would undo the edit on the task rollbackPendingOp just kept.
        abandoned.add(op.issueId);
        await dequeueAllForIssue(op.issueId);
      } else {
        await dequeue(op.opId);
      }
      failures.push(op);
    }
  }

  return { networkUnreachable, failures, deferred };
}
