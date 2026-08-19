import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCachedTasks, setCachedTasks } from "./repository/localCache";
import { enqueueCreate, enqueueFieldUpdate } from "./repository/syncQueue";
import { changeTaskState, createTask, markTaskComplete, markTaskInProgress } from "./storage";
import { Task } from "./types";

vi.mock("./repository/localCache", () => ({
  getCachedTasks: vi.fn(),
  setCachedTasks: vi.fn(),
  getCachedTeamLabels: vi.fn(async () => new Map()),
  setCachedTeamLabels: vi.fn(),
  getCachedTeamStates: vi.fn(async () => new Map()),
  setCachedTeamStates: vi.fn(),
  getCachedTeams: vi.fn(async () => []),
  setCachedTeams: vi.fn(),
}));

vi.mock("./repository/syncQueue", () => ({
  enqueueFieldUpdate: vi.fn(),
  enqueueArchive: vi.fn(),
  enqueueCreate: vi.fn(),
  getQueue: vi.fn(async () => []),
  dequeue: vi.fn(),
  getPendingOpsForIssue: vi.fn(async () => []),
}));

vi.mock("./repository/linearApi", () => ({
  fetchAssignedIssues: vi.fn(async () => ({ tasks: [], teamLabels: new Map(), teams: [] })),
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

  it("falls back to the New placeholder state for local-only tasks with no team", async () => {
    vi.mocked(getCachedTasks).mockResolvedValue([]);

    await createTask({ title: "Quick note", saveToLinear: false });

    expect(setCachedTasks).toHaveBeenCalledWith([
      expect.objectContaining({ syncState: "local", stateId: undefined, stateName: "New", stateType: undefined }),
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
    const t = task({ startStateId: undefined });
    vi.mocked(getCachedTasks).mockResolvedValue([t]);

    await expect(markTaskInProgress(t.id)).rejects.toThrow();

    expect(setCachedTasks).not.toHaveBeenCalled();
    expect(enqueueFieldUpdate).not.toHaveBeenCalled();
  });

  it("moves the task to its team's start state locally and enqueues the Linear update", async () => {
    const t = task({
      stateId: "backlog-id",
      startStateId: "start-id",
      startStateName: "In Progress",
      startStateType: "started",
    });
    vi.mocked(getCachedTasks).mockResolvedValue([t]);

    await markTaskInProgress(t.id);

    expect(setCachedTasks).toHaveBeenCalledWith([
      expect.objectContaining({ id: t.id, stateId: "start-id", stateName: "In Progress", stateType: "started" }),
    ]);
    expect(enqueueFieldUpdate).toHaveBeenCalledWith(t.id, "stateId", "start-id", "backlog-id");
  });

  it("is a harmless no-op when the task is already in the start state", async () => {
    const t = task({
      stateId: "start-id",
      startStateId: "start-id",
      startStateName: "In Progress",
      startStateType: "started",
    });
    vi.mocked(getCachedTasks).mockResolvedValue([t]);

    await expect(markTaskInProgress(t.id)).resolves.toBeUndefined();

    expect(setCachedTasks).not.toHaveBeenCalled();
    expect(enqueueFieldUpdate).not.toHaveBeenCalled();
  });

  it("updates a local-only task's cache without enqueueing a Linear update", async () => {
    const t = task({
      syncState: "local",
      stateId: undefined,
      startStateId: "start-id",
      startStateName: "In Progress",
      startStateType: "started",
    });
    vi.mocked(getCachedTasks).mockResolvedValue([t]);

    await markTaskInProgress(t.id);

    expect(setCachedTasks).toHaveBeenCalled();
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
});

describe("markTaskComplete", () => {
  it("throws instead of silently succeeding when the task's team has no done state resolved", async () => {
    const t = task({ doneStateId: undefined });
    vi.mocked(getCachedTasks).mockResolvedValue([t]);

    await expect(markTaskComplete(t.id)).rejects.toThrow();

    expect(setCachedTasks).not.toHaveBeenCalled();
  });
});
