import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAssignedIssues } from "./repository/linearApi";
import { getCachedTasks, getCachedTeamStates } from "./repository/localCache";
import {
  enqueueComment,
  enqueueCreate,
  enqueueFieldUpdate,
  getPendingOpsForIssue,
  getQueue,
} from "./repository/syncQueue";
import {
  addComment,
  changeTaskState,
  createTask,
  markTaskComplete,
  markTaskInProgress,
  markTaskTodo,
  refreshItemsFromLinear,
  retrievePendingCommentsForTask,
} from "./storage";
import { Task } from "./types";

// Stands in for what updateCachedTasks writes, so tests read the cache from getCachedTasks
// and assert on the write here, without the file lock.
const setCachedTasks = vi.hoisted(() => vi.fn());

vi.mock("./repository/localCache", () => {
  const getCachedTasks = vi.fn();
  return {
    getCachedTasks,
    updateCachedTasks: vi.fn(async (update: (current: Task[]) => Task[] | Promise<Task[]>) => {
      const previous: Task[] = await getCachedTasks();
      const next = await update(previous);
      if (next !== previous) await setCachedTasks(next);
      return { previous, next };
    }),
    getCachedTeamLabels: vi.fn(async () => new Map()),
    setCachedTeamLabels: vi.fn(),
    getCachedTeamStates: vi.fn(async () => new Map()),
    setCachedTeamStates: vi.fn(),
    getCachedTeams: vi.fn(async () => []),
    setCachedTeams: vi.fn(),
  };
});

vi.mock("./repository/syncQueue", () => ({
  enqueueFieldUpdate: vi.fn(),
  enqueueArchive: vi.fn(),
  enqueueCreate: vi.fn(),
  enqueueComment: vi.fn(),
  getQueue: vi.fn(async () => []),
  dequeue: vi.fn(),
  getPendingOpsForIssue: vi.fn(async () => []),
}));

vi.mock("./repository/linearApi", () => ({
  fetchAssignedIssues: vi.fn(async () => ({ tasks: [], teamLabels: new Map(), teams: [] })),
  resolveStateOfType: (states: { type: string; position: number }[], type: string) =>
    [...states].filter((s) => s.type === type).sort((a, b) => a.position - b.position)[0],
}));

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    syncState: "synced",
    title: "Test task",
    priority: 0,
    labelIds: [],
    labelNames: [],
    archivedLocally: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getCachedTasks).mockReset();
  vi.mocked(setCachedTasks).mockReset();
  vi.mocked(enqueueFieldUpdate).mockReset();
  vi.mocked(enqueueCreate).mockReset();
  vi.mocked(enqueueComment).mockReset();
  vi.mocked(getQueue).mockReset().mockResolvedValue([]);
  vi.mocked(getPendingOpsForIssue).mockReset().mockResolvedValue([]);
  vi.mocked(getCachedTeamStates).mockReset().mockResolvedValue(new Map());
});

describe("addComment", () => {
  it("queues a comment for a synced task without touching the cache", async () => {
    vi.mocked(getCachedTasks).mockResolvedValue([task()]);

    await addComment("t1", "Looks done to me");

    expect(enqueueComment).toHaveBeenCalledWith("t1", "Looks done to me");
    expect(setCachedTasks).not.toHaveBeenCalled();
  });

  it("refuses a local-only task, which has no Linear issue to comment on", async () => {
    vi.mocked(getCachedTasks).mockResolvedValue([task({ syncState: "local" })]);

    await expect(addComment("t1", "hi")).rejects.toThrow();
    expect(enqueueComment).not.toHaveBeenCalled();
  });

  it("refuses a task still waiting to be created in Linear (its id is a tempId)", async () => {
    vi.mocked(getCachedTasks).mockResolvedValue([task({ syncState: "pendingCreate" })]);

    await expect(addComment("t1", "hi")).rejects.toThrow();
    expect(enqueueComment).not.toHaveBeenCalled();
  });
});

describe("retrievePendingCommentsForTask", () => {
  it("maps queued comment ops to pending comments and ignores other ops", async () => {
    vi.mocked(getPendingOpsForIssue).mockResolvedValue([
      { opId: "op-1", type: "createComment", issueId: "t1", body: "first", createdAt: "2026-08-25T06:00:00.000Z" },
      { opId: "op-2", type: "archive", issueId: "t1", createdAt: "2026-08-25T06:01:00.000Z" },
    ]);

    const pending = await retrievePendingCommentsForTask("t1");

    expect(pending).toEqual([
      {
        id: "op-1",
        body: "first",
        createdAt: "2026-08-25T06:00:00.000Z",
        authorName: "You",
        reactions: [],
        pending: true,
      },
    ]);
  });
});

describe("refreshItemsFromLinear", () => {
  it("does not treat a pending comment op as an archive when merging the pull", async () => {
    vi.mocked(getCachedTasks).mockResolvedValue([]);
    vi.mocked(fetchAssignedIssues).mockResolvedValue({
      tasks: [task()],
      teamLabels: new Map(),
      teamStates: new Map(),
      teams: [],
    });
    vi.mocked(getQueue).mockResolvedValue([
      { opId: "op-1", type: "createComment", issueId: "t1", body: "hi", createdAt: "2026-08-25T06:00:00.000Z" },
    ]);

    const merged = await refreshItemsFromLinear();

    expect(merged).toEqual([expect.objectContaining({ id: "t1", archivedLocally: false })]);
  });
});

describe("createTask", () => {
  it("carries the picked status through to both the local task and the queued create op", async () => {
    vi.mocked(getCachedTasks).mockResolvedValue([]);

    await createTask({
      title: "New Linear task",
      saveToLinear: true,
      teamId: "team-1",
      teamName: "General",
      stateId: "in-progress-id",
      stateName: "In Progress",
      stateType: "started",
      statePosition: 0,
    });

    expect(setCachedTasks).toHaveBeenCalledWith([
      expect.objectContaining({
        syncState: "pendingCreate",
        stateId: "in-progress-id",
        stateName: "In Progress",
        stateType: "started",
      }),
    ]);
    expect(enqueueCreate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ teamId: "team-1", stateId: "in-progress-id" }),
    );
  });

  it("falls back to the New placeholder state when no stage is provided", async () => {
    vi.mocked(getCachedTasks).mockResolvedValue([]);

    await createTask({ title: "Quick note", saveToLinear: false });

    expect(setCachedTasks).toHaveBeenCalledWith([
      expect.objectContaining({ syncState: "local", stateId: undefined, stateName: "New", stateType: undefined }),
    ]);
    expect(enqueueCreate).not.toHaveBeenCalled();
  });

  it("carries a picked local stage through for a local-only task", async () => {
    vi.mocked(getCachedTasks).mockResolvedValue([]);

    await createTask({ title: "Quick note", saveToLinear: false, stateName: "In Progress", stateType: "started" });

    expect(setCachedTasks).toHaveBeenCalledWith([
      expect.objectContaining({
        syncState: "local",
        stateId: undefined,
        stateName: "In Progress",
        stateType: "started",
      }),
    ]);
    expect(enqueueCreate).not.toHaveBeenCalled();
  });
});

describe("markTaskInProgress", () => {
  // The bug this guards against: moveTaskToState used to silently `return` when the
  // target state couldn't be resolved, so the caller's try/catch never fired and a
  // success toast was shown for a change that never happened — neither locally nor
  // on Linear. It must throw instead, so the caller's existing catch-and-report-failure
  // path actually triggers.
  it("throws instead of silently succeeding when the task's team has no start state resolved", async () => {
    const t = task({ teamId: "team-1" });
    vi.mocked(getCachedTasks).mockResolvedValue([t]);
    vi.mocked(getCachedTeamStates).mockResolvedValue(new Map([["team-1", []]]));

    await expect(markTaskInProgress(t.id)).rejects.toThrow();

    expect(setCachedTasks).not.toHaveBeenCalled();
    expect(enqueueFieldUpdate).not.toHaveBeenCalled();
  });

  it("moves the task to its team's start state locally and enqueues the Linear update", async () => {
    const t = task({ teamId: "team-1", stateId: "backlog-id", stateName: "Backlog", stateType: "backlog" });
    vi.mocked(getCachedTasks).mockResolvedValue([t]);
    vi.mocked(getCachedTeamStates).mockResolvedValue(
      new Map([["team-1", [{ id: "start-id", name: "In Progress", type: "started", position: 0 }]]]),
    );

    await markTaskInProgress(t.id);

    expect(setCachedTasks).toHaveBeenCalledWith([
      expect.objectContaining({ id: t.id, stateId: "start-id", stateName: "In Progress", stateType: "started" }),
    ]);
    expect(enqueueFieldUpdate).toHaveBeenCalledWith(t.id, "stateId", "start-id", "backlog-id");
  });

  it("is a harmless no-op when the task is already in the start state", async () => {
    const t = task({ teamId: "team-1", stateId: "start-id", stateName: "In Progress", stateType: "started" });
    vi.mocked(getCachedTasks).mockResolvedValue([t]);
    vi.mocked(getCachedTeamStates).mockResolvedValue(
      new Map([["team-1", [{ id: "start-id", name: "In Progress", type: "started", position: 0 }]]]),
    );

    await expect(markTaskInProgress(t.id)).resolves.toBeUndefined();

    expect(setCachedTasks).not.toHaveBeenCalled();
    expect(enqueueFieldUpdate).not.toHaveBeenCalled();
  });

  it("moves a local-only task to LOCAL_STAGES' In Progress without enqueueing a Linear update", async () => {
    const t = task({ syncState: "local", stateId: undefined, stateName: "Backlog", stateType: "backlog" });
    vi.mocked(getCachedTasks).mockResolvedValue([t]);

    await markTaskInProgress(t.id);

    expect(setCachedTasks).toHaveBeenCalledWith([
      expect.objectContaining({ id: t.id, stateId: undefined, stateName: "In Progress", stateType: "started" }),
    ]);
    expect(enqueueFieldUpdate).not.toHaveBeenCalled();
  });
});

describe("markTaskTodo", () => {
  it("moves the task to its team's unstarted state locally and enqueues the Linear update", async () => {
    const t = task({ teamId: "team-1", stateId: "start-id", stateName: "In Progress", stateType: "started" });
    vi.mocked(getCachedTasks).mockResolvedValue([t]);
    vi.mocked(getCachedTeamStates).mockResolvedValue(
      new Map([["team-1", [{ id: "todo-id", name: "Todo", type: "unstarted", position: 0 }]]]),
    );

    await markTaskTodo(t.id);

    expect(setCachedTasks).toHaveBeenCalledWith([
      expect.objectContaining({ id: t.id, stateId: "todo-id", stateName: "Todo", stateType: "unstarted" }),
    ]);
    expect(enqueueFieldUpdate).toHaveBeenCalledWith(t.id, "stateId", "todo-id", "start-id");
  });

  it("moves a local-only task to LOCAL_STAGES' Todo without enqueueing a Linear update", async () => {
    const t = task({ syncState: "local", stateId: undefined, stateName: "In Progress", stateType: "started" });
    vi.mocked(getCachedTasks).mockResolvedValue([t]);

    await markTaskTodo(t.id);

    expect(setCachedTasks).toHaveBeenCalledWith([
      expect.objectContaining({ id: t.id, stateId: undefined, stateName: "Todo", stateType: "unstarted" }),
    ]);
    expect(enqueueFieldUpdate).not.toHaveBeenCalled();
  });
});

describe("changeTaskState", () => {
  it("moves a task to any state the caller picks, not just the resolved start/done state", async () => {
    const t = task({ stateId: "backlog-id", stateName: "Backlog", stateType: "backlog" });
    vi.mocked(getCachedTasks).mockResolvedValue([t]);

    await changeTaskState(t.id, "triage-id", "Triage", "triage");

    expect(setCachedTasks).toHaveBeenCalledWith([
      expect.objectContaining({ id: t.id, stateId: "triage-id", stateName: "Triage", stateType: "triage" }),
    ]);
    expect(enqueueFieldUpdate).toHaveBeenCalledWith(t.id, "stateId", "triage-id", "backlog-id");
  });

  it("moves a local-only task to a picked LOCAL_STAGES entry with no id", async () => {
    const t = task({ syncState: "local", stateId: undefined, stateName: "Backlog", stateType: "backlog" });
    vi.mocked(getCachedTasks).mockResolvedValue([t]);

    await changeTaskState(t.id, undefined, "Done", "completed");

    expect(setCachedTasks).toHaveBeenCalledWith([
      expect.objectContaining({ id: t.id, stateId: undefined, stateName: "Done", stateType: "completed" }),
    ]);
    expect(enqueueFieldUpdate).not.toHaveBeenCalled();
  });
});

describe("markTaskComplete", () => {
  it("throws instead of silently succeeding when the task's team has no done state resolved", async () => {
    const t = task({ teamId: "team-1" });
    vi.mocked(getCachedTasks).mockResolvedValue([t]);
    vi.mocked(getCachedTeamStates).mockResolvedValue(new Map([["team-1", []]]));

    await expect(markTaskComplete(t.id)).rejects.toThrow();

    expect(setCachedTasks).not.toHaveBeenCalled();
  });

  it("moves a local-only task to LOCAL_STAGES' Done without enqueueing a Linear update", async () => {
    const t = task({ syncState: "local", stateId: undefined, stateName: "In Progress", stateType: "started" });
    vi.mocked(getCachedTasks).mockResolvedValue([t]);

    await markTaskComplete(t.id);

    expect(setCachedTasks).toHaveBeenCalledWith([
      expect.objectContaining({ id: t.id, stateId: undefined, stateName: "Done", stateType: "completed" }),
    ]);
    expect(enqueueFieldUpdate).not.toHaveBeenCalled();
  });
});
