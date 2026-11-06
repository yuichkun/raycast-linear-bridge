import { beforeEach, describe, expect, it, vi } from "vitest";
import { archiveIssue, createIssue, updateIssueField } from "../repository/linearApi";
import { dequeue, getQueue, SyncOp, UpdateFieldOp } from "../repository/syncQueue";
import { resolveCreatedTask, rollbackPendingOp } from "../storage";
import { bareHttpAnswer, graphqlError, offline } from "../test/linearErrors";
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

const rateLimited = () => graphqlError("ratelimited", "Rate limit exceeded");
const rejected = () => graphqlError("invalid input", "Argument Validation Error");

function updateOp(id: string, issueId: string, value: string): UpdateFieldOp {
  return {
    opId: `op-${id}`,
    type: "updateField",
    issueId,
    field: "stateId",
    value,
    previousValue: "before",
    createdAt: "2026-08-25T06:00:00.000Z",
  };
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

  it("keeps every op queued (and reports unreachable) when Linear can't be reached", async () => {
    queue = [createOp("1"), createOp("2")];
    vi.mocked(createIssue).mockRejectedValue(offline());

    const result = await processQueue();

    expect(result.networkUnreachable).toBe(true);
    expect(rollbackPendingOp).not.toHaveBeenCalled();
    expect(queue).toHaveLength(2);
    // Nothing else can get through without a network, so the run stops at the first failure.
    expect(createIssue).toHaveBeenCalledTimes(1);
  });

  it("rolls back and drops an op Linear explicitly rejected", async () => {
    const op = createOp("1");
    queue = [op];
    vi.mocked(createIssue).mockRejectedValue(rejected());

    const result = await processQueue();

    expect(rollbackPendingOp).toHaveBeenCalledWith(op);
    expect(result.failures).toEqual([op]);
    expect(queue).toEqual([]);
  });

  // The data-loss bug: a rate limit (like a 5xx) used to be read as "Linear rejected the
  // change", which rolled it back and dropped it from the queue.
  it("keeps a rate-limited op queued instead of rolling it back", async () => {
    const op = updateOp("1", "issue-1", "done-id");
    queue = [op];
    vi.mocked(updateIssueField).mockRejectedValue(rateLimited());

    const result = await processQueue();

    expect(rollbackPendingOp).not.toHaveBeenCalled();
    expect(result.failures).toEqual([]);
    expect(result.networkUnreachable).toBe(false);
    expect(result.deferred).toBe(1);
    expect(queue).toEqual([op]);
  });

  // A bare 403 — a firewall's or proxy's page — used to roll back and empty the whole queue.
  it("keeps ops queued when the answer is an HTTP error page rather than Linear's verdict", async () => {
    const op = updateOp("1", "issue-1", "done-id");
    queue = [op];
    vi.mocked(updateIssueField).mockRejectedValue(bareHttpAnswer(403, "<html>Access denied</html>"));

    const result = await processQueue();

    expect(rollbackPendingOp).not.toHaveBeenCalled();
    expect(result.deferred).toBe(1);
    expect(queue).toEqual([op]);
  });

  it("holds an issue's later ops behind one left queued, so they can't reach Linear out of order", async () => {
    const inProgress = updateOp("1", "issue-1", "in-progress-id");
    const done = updateOp("2", "issue-1", "done-id");
    queue = [inProgress, done];
    vi.mocked(updateIssueField).mockRejectedValueOnce(rateLimited()).mockResolvedValue(undefined);

    const result = await processQueue();

    expect(updateIssueField).toHaveBeenCalledTimes(1);
    expect(result.deferred).toBe(2);
    expect(queue).toEqual([inProgress, done]);
  });

  it("still sends other issues' ops when one issue's op is left queued", async () => {
    const held = updateOp("1", "issue-1", "done-id");
    const other = updateOp("2", "issue-2", "done-id");
    queue = [held, other];
    vi.mocked(updateIssueField).mockRejectedValueOnce(rateLimited()).mockResolvedValue(undefined);

    await processQueue();

    expect(vi.mocked(updateIssueField).mock.calls.map(([issueId]) => issueId)).toEqual(["issue-1", "issue-2"]);
    expect(queue).toEqual([held]);
  });
});
