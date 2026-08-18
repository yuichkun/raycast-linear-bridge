import { refreshItemsFromLinear } from "../storage";
import { Task } from "../types";
import { processQueue, ProcessQueueResult } from "./processQueue";

export type SyncResult = {
  tasks: Task[];
  queueResult: ProcessQueueResult;
};

// Push before pull: flush whatever's in the queue first so a just-made local change is
// reflected in Linear's state before we pull it back down, rather than racing a pull that
// might otherwise (harmlessly, thanks to the pending-op merge in refreshItemsFromLinear,
// but still confusingly) arrive first.
export async function runSync(): Promise<SyncResult> {
  const queueResult = await processQueue();
  const tasks = await refreshItemsFromLinear();
  return { tasks, queueResult };
}
