import { beforeEach, describe, expect, it, vi } from "vitest";
import { archiveIssue, createIssue, updateIssueField } from "../repository/linearApi";
import { dequeue, getQueue, SyncOp } from "../repository/syncQueue";
import { resolveCreatedTask, rollbackPendingOp } from "../storage";
import { processQueue } from "./processQueue";

vi.mock("../repository/linearApi", () => ({
  archiveIssue: vi.fn(),
  createComment: vi.fn(),
  createIssue: vi.fn(),
  updateIssueField: vi.fn(),
}));

vi.mock("../repository/syncQueue", () => ({
  dequeue: vi.fn(),
  getQueue: vi.fn(),
}));

vi.mock("../storage", () => ({
  resolveCreatedTask: vi.fn(),
  rollbackPendingOp: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createOp(id: string): SyncOp {
  return {
    opId: `op-${id}`,
    type: "create",
    issueId: `temp-${id}`,
    input: { teamId: "team-1", title: `Task ${id}` },
    createdAt: "2026-08-25T06:00:00.000Z",
  };
}

// A real queue: getQueue returns what's there, dequeue removes it — so a second run that
// starts after the first has dequeued sees an empty queue, exactly like the file on disk.
let queue: SyncOp[];

beforeEach(() => {
  queue = [];
  vi.mocked(getQueue)
    .mockReset()
    .mockImplementation(async () => [...queue]);
  vi.mocked(dequeue)
    .mockReset()
    .mockImplementation(async (opId: string) => {
      queue = queue.filter((op) => op.opId !== opId);
    });
  vi.mocked(createIssue).mockReset();
  vi.mocked(updateIssueField).mockReset();
  vi.mocked(archiveIssue).mockReset();
  vi.mocked(resolveCreatedTask).mockReset();
  vi.mocked(rollbackPendingOp).mockReset();
});

describe("processQueue", () => {
  // The duplicate-issue bug: sync gets kicked from several places (List Tasks mount,
  // every action's refetchList, the interval command). Two overlapping runs both read
  // the queue before either dequeues, and both send the same create.
  it("sends a queued create once even when a second sync is kicked mid-run", async () => {
    queue = [createOp("1")];
    const linearCall = deferred<string>();
    vi.mocked(createIssue).mockReturnValue(linearCall.promise);

    const first = processQueue();
    const second = processQueue(); // kicked while the first is still waiting on Linear
    linearCall.resolve("temp-1");
    await Promise.all([first, second]);

    expect(createIssue).toHaveBeenCalledTimes(1);
    expect(resolveCreatedTask).toHaveBeenCalledTimes(1);
    expect(queue).toEqual([]);
  });

  it("still sends an op enqueued after a running sync read the queue", async () => {
    queue = [createOp("1")];
    const firstCall = deferred<string>();
    vi.mocked(createIssue).mockReturnValueOnce(firstCall.promise).mockResolvedValue("temp-2");

    const first = processQueue();
    await new Promise((resolve) => setTimeout(resolve, 0)); // let it read the queue and call Linear
    queue.push(createOp("2")); // enqueued mid-run, e.g. a second Create Task
    const second = processQueue();
    firstCall.resolve("temp-1");
    await Promise.all([first, second]);

    expect(vi.mocked(createIssue).mock.calls.map(([tempId]) => tempId)).toEqual(["temp-1", "temp-2"]);
    expect(queue).toEqual([]);
  });

  it("keeps an op queued (and reports unreachable) when Linear can't be reached", async () => {
    queue = [createOp("1")];
    vi.mocked(createIssue).mockRejectedValue(new Error("fetch failed"));

    const result = await processQueue();

    expect(result.networkUnreachable).toBe(true);
    expect(rollbackPendingOp).not.toHaveBeenCalled();
    expect(queue).toHaveLength(1);
  });

  it("rolls back and drops an op Linear explicitly rejected", async () => {
    const op = createOp("1");
    queue = [op];
    vi.mocked(createIssue).mockRejectedValue(new Error("Argument Validation Error"));

    const result = await processQueue();

    expect(rollbackPendingOp).toHaveBeenCalledWith(op);
    expect(result.failures).toEqual([op]);
    expect(queue).toEqual([]);
  });
});
