import { isLinearUnreachable } from "../repository/linearErrors";
import { refreshItemsFromLinear, retrieveCachedItems } from "../storage";
import { Task } from "../types";
import { processQueue, ProcessQueueResult } from "./processQueue";

export type SyncResult = {
  tasks: Task[];
  // Linear couldn't be reached for the push, the pull, or both. Nothing is lost when this
  // is set: queued changes stay queued for the next run, and `tasks` is what the cache
  // holds (including those changes, applied optimistically).
  networkUnreachable: boolean;
  queueResult: ProcessQueueResult;
};

// Push before pull: flush whatever's in the queue first so a just-made local change is
// reflected in Linear's state before we pull it back down, rather than racing a pull that
// might otherwise (harmlessly, thanks to the pending-op merge in refreshItemsFromLinear,
// but still confusingly) arrive first.
//
// Being unable to reach Linear is the expected case for an offline-first extension, not
// an error, so the pull reports it in the result the same way processQueue does for the
// push instead of throwing. A caller that awaits this only has to catch what is actually
// wrong — a rejected API key, an unreadable cache file — and a caller that doesn't await
// it can't turn a missing network into an unhandled rejection.
export async function runSync(): Promise<SyncResult> {
  const queueResult = await processQueue();
  try {
    const tasks = await refreshItemsFromLinear();
    return { tasks, networkUnreachable: queueResult.networkUnreachable, queueResult };
  } catch (error) {
    if (!isLinearUnreachable(error)) throw error;
    return { tasks: await retrieveCachedItems(), networkUnreachable: true, queueResult };
  }
}
