import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAssignedIssues } from "./repository/linearApi";
import {
  CachedLabel,
  CachedState,
  getCachedTasks,
  getCachedTeamLabels,
  getCachedTeamStates,
} from "./repository/localCache";
import {
  enqueueArchive,
  enqueueComment,
  enqueueCreate,
  enqueueFieldUpdate,
  getPendingOpsForIssue,
  getQueue,
  SyncOp,
} from "./repository/syncQueue";
import {
  addComment,
  archiveTask,
  changeTaskState,
  createTask,
  markTaskComplete,
  markTaskInProgress,
  markTaskTodo,
  promoteToLinear,
  refreshItemsFromLinear,
  renameTask,
  retrievePendingCommentsForTask,
  retrieveSectionEmoji,
  rollbackPendingOp,
  updateLabels,
} from "./storage";
import { Task } from "./types";

// Stands in for what updateCachedTasks writes, so tests read the cache from getCachedTasks
// and assert on the write here, without the file lock.
const setCachedTasks = vi.hoisted(() => vi.fn());

// Stands in for sectionEmoji.json.
const sectionEmojiFile = vi.hoisted(() => ({ current: {} as Record<string, string> }));

vi.mock("./repository/sectionEmojiFile", () => ({
  updateSectionEmoji: vi.fn(async (update: (current: Record<string, string>) => Record<string, string>) => {
    sectionEmojiFile.current = update(sectionEmojiFile.current);
    return sectionEmojiFile.current;
  }),
}));

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

// The real resolveStateOfType: which state Mark as Complete picks is what's under test here.
vi.mock("./repository/linearApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./repository/linearApi")>()),
  fetchAssignedIssues: vi.fn(async () => ({ tasks: [], teamLabels: new Map(), teamStates: new Map(), teams: [] })),
}));

function teamStates(states: CachedState[]): Map<string, CachedState[]> {
  return new Map([["team-1", states]]);
}

function teamLabels(labels: CachedLabel[]): Map<string, CachedLabel[]> {
  return new Map([["team-1", labels]]);
}

const todo: CachedState = { id: "todo-id", name: "Todo", type: "unstarted", position: 1 };
const inProgress: CachedState = { id: "in-progress-id", name: "In Progress", type: "started", position: 2 };
const done: CachedState = { id: "done-id", name: "Done", type: "completed", position: 3 };

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
  vi.mocked(enqueueArchive).mockReset();
  vi.mocked(enqueueCreate).mockReset();
  vi.mocked(enqueueComment).mockReset();
  vi.mocked(getQueue).mockReset().mockResolvedValue([]);
  vi.mocked(getPendingOpsForIssue).mockReset().mockResolvedValue([]);
  vi.mocked(getCachedTeamStates).mockReset().mockResolvedValue(new Map());
  vi.mocked(getCachedTeamLabels).mockReset().mockResolvedValue(new Map());
  sectionEmojiFile.current = {};
});

describe("retrieveSectionEmoji", () => {
  it("gives every team's statuses and the local-only stages an emoji", async () => {
    const pending: CachedState = { id: "pending-id", name: "Pending", type: "started", position: 5 };
    vi.mocked(getCachedTeamStates).mockResolvedValue(
      new Map([
        ["team-1", [todo, inProgress, pending, done]],
        ["team-2", [{ ...inProgress, id: "other-in-progress-id" }]],
      ]),
    );

    const emoji = await retrieveSectionEmoji();

    // Backlog comes from LOCAL_STAGES: neither team has a Linear status of that name.
    expect(emoji).toEqual({ "In Progress": "🔥", Pending: "⚡", Todo: "📝", Backlog: "🗂️" });
  });

  it("keeps what was already assigned when a status turns up ahead of it", async () => {
    sectionEmojiFile.current = { "In Progress": "🔥", Todo: "📝", Backlog: "🗂️" };
    const longRunning: CachedState = { id: "long-id", name: "Long Running", type: "started", position: 0 };
    vi.mocked(getCachedTeamStates).mockResolvedValue(teamStates([longRunning, inProgress, todo]));

    const emoji = await retrieveSectionEmoji();

    expect(emoji).toEqual({ "In Progress": "🔥", Todo: "📝", Backlog: "🗂️", "Long Running": "⚡" });
  });
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
  const triage: CachedState = { id: "triage-id", name: "Triage", type: "triage", position: 0 };

  it("moves a task to any state the caller picks, not just the resolved start/done state", async () => {
    const t = task({ teamId: "team-1", stateId: "backlog-id", stateName: "Backlog", stateType: "backlog" });
    vi.mocked(getCachedTasks).mockResolvedValue([t]);
    vi.mocked(getCachedTeamStates).mockResolvedValue(teamStates([triage]));

    await changeTaskState(t.id, { stateId: "triage-id" });

    expect(setCachedTasks).toHaveBeenCalledWith([
      expect.objectContaining({ id: t.id, stateId: "triage-id", stateName: "Triage", stateType: "triage" }),
    ]);
    expect(enqueueFieldUpdate).toHaveBeenCalledWith(t.id, "stateId", "triage-id", "backlog-id");
  });

  it("takes the name, type and position from the team's state with that id", async () => {
    const t = task({
      teamId: "team-1",
      stateId: "todo-id",
      stateName: "Todo",
      stateType: "unstarted",
      statePosition: 1,
    });
    vi.mocked(getCachedTasks).mockResolvedValue([t]);
    vi.mocked(getCachedTeamStates).mockResolvedValue(teamStates([todo, done]));

    await changeTaskState(t.id, { stateId: "done-id" });

    expect(setCachedTasks).toHaveBeenCalledWith([
      expect.objectContaining({ stateId: "done-id", stateName: "Done", stateType: "completed", statePosition: 3 }),
    ]);
  });

  it("refuses a state id the task's team doesn't have", async () => {
    const t = task({ teamId: "team-1", stateId: "todo-id" });
    vi.mocked(getCachedTasks).mockResolvedValue([t]);
    vi.mocked(getCachedTeamStates).mockResolvedValue(teamStates([todo]));

    await expect(changeTaskState(t.id, { stateId: "some-other-teams-state" })).rejects.toThrow();

    expect(setCachedTasks).not.toHaveBeenCalled();
    expect(enqueueFieldUpdate).not.toHaveBeenCalled();
  });

  it("moves a local-only task to a picked LOCAL_STAGES entry with no id", async () => {
    const t = task({ syncState: "local", stateId: undefined, stateName: "Backlog", stateType: "backlog" });
    vi.mocked(getCachedTasks).mockResolvedValue([t]);

    await changeTaskState(t.id, { localStageType: "completed" });

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

  // General's real completed states as of 2026-11-06 (positions from the cached tasks):
  // "Done" comes first in Linear's order, 【案件】検品中 after it.
  it("picks the team's first completed state, not one after it", async () => {
    const inspecting: CachedState = {
      id: "inspecting-id",
      name: "【案件】検品中",
      type: "completed",
      position: 3549.8,
    };
    const t = task({ teamId: "team-1", stateId: "in-progress-id", stateName: "In Progress", stateType: "started" });
    vi.mocked(getCachedTasks).mockResolvedValue([t]);
    vi.mocked(getCachedTeamStates).mockResolvedValue(teamStates([inspecting, inProgress, done]));

    await markTaskComplete(t.id);

    expect(setCachedTasks).toHaveBeenCalledWith([expect.objectContaining({ stateId: "done-id", stateName: "Done" })]);
  });

  // Moving a task used to leave its old statePosition behind, which is what orders the
  // sections it lands in.
  it("writes the new state's position along with its id, name and type", async () => {
    const t = task({
      teamId: "team-1",
      stateId: "in-progress-id",
      stateName: "In Progress",
      stateType: "started",
      statePosition: 2,
    });
    vi.mocked(getCachedTasks).mockResolvedValue([t]);
    vi.mocked(getCachedTeamStates).mockResolvedValue(teamStates([inProgress, done]));

    await markTaskComplete(t.id);

    expect(setCachedTasks).toHaveBeenCalledWith([
      expect.objectContaining({ stateId: "done-id", stateName: "Done", stateType: "completed", statePosition: 3 }),
    ]);
  });
});

describe("updateLabels", () => {
  // The labels shown in the list come from labelNames: setting only labelIds left the old
  // labels on screen until the next pull, indefinitely while offline.
  it("updates the label names shown along with the ids", async () => {
    const t = task({ teamId: "team-1", labelIds: ["a"], labelNames: ["Alpha"] });
    vi.mocked(getCachedTasks).mockResolvedValue([t]);
    vi.mocked(getCachedTeamLabels).mockResolvedValue(
      teamLabels([
        { id: "a", name: "Alpha" },
        { id: "b", name: "Beta" },
      ]),
    );

    await updateLabels(t.id, ["b"]);

    expect(setCachedTasks).toHaveBeenCalledWith([expect.objectContaining({ labelIds: ["b"], labelNames: ["Beta"] })]);
    expect(enqueueFieldUpdate).toHaveBeenCalledWith(t.id, "labelIds", ["b"], ["a"]);
  });

  it("keeps the name of a label the task already has even when the team's list lacks it", async () => {
    const t = task({ teamId: "team-1", labelIds: ["ws"], labelNames: ["suara"] });
    vi.mocked(getCachedTasks).mockResolvedValue([t]);
    vi.mocked(getCachedTeamLabels).mockResolvedValue(teamLabels([{ id: "b", name: "Beta" }]));

    await updateLabels(t.id, ["ws", "b"]);

    expect(setCachedTasks).toHaveBeenCalledWith([expect.objectContaining({ labelNames: ["suara", "Beta"] })]);
  });
});

describe("rollbackPendingOp", () => {
  function stateOp(value: string, previousValue: string): SyncOp {
    return {
      opId: "op-1",
      type: "updateField",
      issueId: "t1",
      field: "stateId",
      value,
      previousValue,
      createdAt: "2026-11-06T00:00:00.000Z",
    };
  }

  // Rolling back used to restore only the stateId, so a refused Mark as Complete left the
  // task in the Done section under its old state's id.
  it("puts back the previous state's name, type and position with its id", async () => {
    const t = task({
      teamId: "team-1",
      stateId: "done-id",
      stateName: "Done",
      stateType: "completed",
      statePosition: 3,
    });
    vi.mocked(getCachedTasks).mockResolvedValue([t]);
    vi.mocked(getCachedTeamStates).mockResolvedValue(teamStates([inProgress, done]));

    await rollbackPendingOp(stateOp("done-id", "in-progress-id"));

    expect(setCachedTasks).toHaveBeenCalledWith([
      expect.objectContaining({
        stateId: "in-progress-id",
        stateName: "In Progress",
        stateType: "started",
        statePosition: 2,
      }),
    ]);
  });

  const createOp: SyncOp = {
    opId: "op-create",
    type: "create",
    issueId: "temp-1",
    input: { teamId: "team-1", title: "Draft" },
    createdAt: "2026-11-06T00:00:00.000Z",
  };

  // A refused create used to delete the task — and with it everything written in it.
  it("turns a task whose create Linear refused back into a local-only one, keeping what was written", async () => {
    const t = task({
      id: "temp-1",
      syncState: "pendingCreate",
      title: "Draft",
      description: "Notes",
      dueDate: "2026-11-10",
      teamId: "team-1",
      teamName: "General",
      stateId: "in-progress-id",
      stateName: "In Progress",
      stateType: "started",
      statePosition: 2,
      labelIds: ["a"],
      labelNames: ["Alpha"],
    });
    vi.mocked(getCachedTasks).mockResolvedValue([t]);

    await rollbackPendingOp(createOp);

    expect(setCachedTasks).toHaveBeenCalledWith([
      {
        ...t,
        syncState: "local",
        teamId: undefined,
        teamName: undefined,
        stateId: undefined,
        stateName: "In Progress",
        stateType: "started",
        statePosition: undefined,
        labelIds: [],
        labelNames: [],
        url: undefined,
      },
    ]);
  });

  it("drops a task whose create Linear refused if it was archived while waiting", async () => {
    vi.mocked(getCachedTasks).mockResolvedValue([
      task({ id: "temp-1", syncState: "pendingCreate", archivedLocally: true }),
    ]);

    await rollbackPendingOp(createOp);

    expect(setCachedTasks).toHaveBeenCalledWith([]);
  });

  // List Tasks can queue an edit for a pending task just as the Sync process finds its create
  // refused and turns it back into a local-only one. That edit then fails against an issue
  // that doesn't exist — and rolling it back would undo the edit on the task that was kept.
  it("leaves a local-only task's edits alone when an op queued for its refused create fails", async () => {
    vi.mocked(getCachedTasks).mockResolvedValue([task({ id: "temp-1", syncState: "local", title: "Renamed" })]);

    await rollbackPendingOp({
      opId: "op-late",
      type: "updateField",
      issueId: "temp-1",
      field: "title",
      value: "Renamed",
      previousValue: "Draft",
      createdAt: "2026-11-06T00:00:00.000Z",
    });

    expect(setCachedTasks).not.toHaveBeenCalled();
  });
});

// A task saved to Linear is "pendingCreate" until its create goes through — for a moment
// online, for as long as it takes offline. Changes made in that time used to stay local
// only: the issue was created as first written, and the next pull put that version back.
describe("a task waiting to be created in Linear", () => {
  const pending = () =>
    task({
      id: "temp-1",
      syncState: "pendingCreate",
      teamId: "team-1",
      stateId: "todo-id",
      stateName: "Todo",
      stateType: "unstarted",
    });

  it("queues an edit against the id the issue will have", async () => {
    vi.mocked(getCachedTasks).mockResolvedValue([pending()]);

    await renameTask("temp-1", "Renamed");

    expect(enqueueFieldUpdate).toHaveBeenCalledWith("temp-1", "title", "Renamed", "Test task");
  });

  it("queues a status change the same way", async () => {
    vi.mocked(getCachedTasks).mockResolvedValue([pending()]);
    vi.mocked(getCachedTeamStates).mockResolvedValue(teamStates([todo, done]));

    await markTaskComplete("temp-1");

    expect(enqueueFieldUpdate).toHaveBeenCalledWith("temp-1", "stateId", "done-id", "todo-id");
  });

  // Dropping it from the cache instead left its create queued, so the issue was created
  // anyway and came back on the next pull.
  it("is archived through the queue, behind its create, rather than dropped", async () => {
    vi.mocked(getCachedTasks).mockResolvedValue([pending()]);

    await archiveTask("temp-1");

    expect(setCachedTasks).toHaveBeenCalledWith([expect.objectContaining({ id: "temp-1", archivedLocally: true })]);
    expect(enqueueArchive).toHaveBeenCalledWith("temp-1");
  });

  it("is replaced by Linear's copy once a pull finds it already created", async () => {
    vi.mocked(getCachedTasks).mockResolvedValue([pending()]);
    vi.mocked(fetchAssignedIssues).mockResolvedValue({
      tasks: [task({ id: "temp-1", teamId: "team-1", stateId: "todo-id", stateName: "Todo", stateType: "unstarted" })],
      teamLabels: new Map(),
      teamStates: teamStates([todo]),
      teams: [],
    });

    const merged = await refreshItemsFromLinear();

    expect(merged).toEqual([expect.objectContaining({ id: "temp-1", syncState: "synced" })]);
  });
});

describe("refreshItemsFromLinear with a queued state change", () => {
  // Laying a pending stateId over the pull used to set only the id, so the task showed
  // under Linear's (old) state name while carrying the queued state's id.
  it("shows the queued state's name and type, from the metadata pulled alongside", async () => {
    vi.mocked(getCachedTasks).mockResolvedValue([]);
    vi.mocked(fetchAssignedIssues).mockResolvedValue({
      tasks: [
        task({
          teamId: "team-1",
          stateId: "in-progress-id",
          stateName: "In Progress",
          stateType: "started",
          statePosition: 2,
        }),
      ],
      teamLabels: new Map(),
      teamStates: teamStates([inProgress, done]),
      teams: [],
    });
    vi.mocked(getQueue).mockResolvedValue([
      {
        opId: "op-1",
        type: "updateField",
        issueId: "t1",
        field: "stateId",
        value: "done-id",
        previousValue: "in-progress-id",
        createdAt: "2026-11-06T00:00:00.000Z",
      },
    ]);

    const merged = await refreshItemsFromLinear();

    expect(merged).toEqual([
      expect.objectContaining({ stateId: "done-id", stateName: "Done", stateType: "completed", statePosition: 3 }),
    ]);
  });
});

describe("promoteToLinear", () => {
  it("takes the state's name, type and position from the team's states", async () => {
    vi.mocked(getCachedTasks).mockResolvedValue([
      task({ syncState: "local", stateName: "Todo", stateType: "unstarted" }),
    ]);
    vi.mocked(getCachedTeamStates).mockResolvedValue(teamStates([todo, inProgress]));

    await promoteToLinear("t1", { id: "team-1", name: "General" }, "in-progress-id");

    expect(setCachedTasks).toHaveBeenCalledWith([
      expect.objectContaining({
        syncState: "pendingCreate",
        teamId: "team-1",
        teamName: "General",
        stateId: "in-progress-id",
        stateName: "In Progress",
        stateType: "started",
        statePosition: 2,
      }),
    ]);
    expect(enqueueCreate).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ teamId: "team-1", stateId: "in-progress-id" }),
    );
  });
});
