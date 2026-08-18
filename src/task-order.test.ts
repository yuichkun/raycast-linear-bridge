import { describe, expect, it } from "vitest";
import { classifyTask, groupTasksBySection } from "./task-order";
import { Task } from "./types";

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    syncState: "synced",
    title: id,
    priority: 0,
    stateType: "unstarted",
    labelIds: [],
    labelNames: [],
    ...overrides,
  };
}

describe("classifyTask", () => {
  it("classifies completed tasks as complete regardless of due date", () => {
    expect(classifyTask(task("t1", { stateType: "completed", dueDate: "2000-01-01" }))).toBe("complete");
  });

  it("classifies overdue, incomplete tasks as outdated", () => {
    expect(classifyTask(task("t2", { dueDate: "2000-01-01" }))).toBe("outdated");
  });

  it("classifies non-overdue, non-completed tasks as state", () => {
    expect(classifyTask(task("t3", { dueDate: "2999-01-01" }))).toBe("state");
    expect(classifyTask(task("t4"))).toBe("state");
  });

  it("hides canceled and duplicate tasks", () => {
    expect(classifyTask(task("t5", { stateType: "canceled" }))).toBe("hidden");
    expect(classifyTask(task("t6", { stateType: "duplicate" }))).toBe("hidden");
  });
});

describe("groupTasksBySection", () => {
  it("always includes Outdated and Complete sections, even when empty", () => {
    const sections = groupTasksBySection([]);
    expect(sections.map((s) => s.key)).toEqual(["outdated", "complete"]);
    expect(sections.every((s) => s.tasks.length === 0)).toBe(true);
  });

  it("drops canceled/duplicate tasks entirely", () => {
    const sections = groupTasksBySection([task("c", { stateType: "canceled" })]);
    const allTasks = sections.flatMap((s) => s.tasks);
    expect(allTasks).toHaveLength(0);
  });

  it("splits distinct states into separate sections instead of one Incomplete bucket", () => {
    const pending = task("p", {
      stateId: "state-pending",
      stateName: "Pending",
      stateType: "started",
      statePosition: 1,
    });
    const inProgress = task("ip", {
      stateId: "state-in-progress",
      stateName: "In Progress",
      stateType: "started",
      statePosition: 0,
    });

    const sections = groupTasksBySection([pending, inProgress]);
    const stateSections = sections.filter((s) => s.key !== "outdated" && s.key !== "complete");

    expect(stateSections).toHaveLength(2);
    // Both are "started", so they sort by statePosition: In Progress (0) before Pending (1).
    expect(stateSections.map((s) => s.title)).toEqual(["In Progress", "Pending"]);
  });

  it("orders sections by status-type progression: backlog -> unstarted -> started", () => {
    const started = task("s", { stateId: "s1", stateName: "In Progress", stateType: "started" });
    const backlog = task("b", { stateId: "s2", stateName: "Backlog", stateType: "backlog" });
    const unstarted = task("u", { stateId: "s3", stateName: "Todo", stateType: "unstarted" });

    const sections = groupTasksBySection([started, backlog, unstarted]);
    const stateSections = sections.filter((s) => s.key !== "outdated" && s.key !== "complete");

    expect(stateSections.map((s) => s.title)).toEqual(["Backlog", "Todo", "In Progress"]);
  });

  it("keeps overdue tasks in Outdated regardless of their state", () => {
    const overdue = task("o", { dueDate: "2000-01-01", stateType: "started" });
    const sections = groupTasksBySection([overdue]);
    const outdatedSection = sections.find((s) => s.key === "outdated");
    expect(outdatedSection?.tasks.map((t) => t.id)).toEqual(["o"]);
  });

  it("groups tasks sharing the same stateId into one section", () => {
    const a = task("a", { stateId: "shared", stateName: "Todo", stateType: "unstarted" });
    const b = task("b", { stateId: "shared", stateName: "Todo", stateType: "unstarted" });
    const sections = groupTasksBySection([a, b]);
    const stateSections = sections.filter((s) => s.key !== "outdated" && s.key !== "complete");
    expect(stateSections).toHaveLength(1);
    expect(stateSections[0].tasks.map((t) => t.id)).toEqual(["a", "b"]);
  });
});
