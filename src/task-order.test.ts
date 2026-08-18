import { describe, expect, it } from "vitest";
import { getTaskSection, groupTasksBySection } from "./task-order";
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
    pinned: false,
    ...overrides,
  };
}

describe("getTaskSection", () => {
  it("classifies completed tasks as complete regardless of due date or pin state", () => {
    expect(getTaskSection(task("t1", { stateType: "completed", dueDate: "2000-01-01", pinned: true }))).toBe(
      "complete",
    );
  });

  it("classifies overdue, incomplete tasks as outdated even if pinned", () => {
    expect(getTaskSection(task("t2", { dueDate: "2000-01-01", pinned: true }))).toBe("outdated");
  });

  it("classifies pinned, non-overdue tasks as pinned", () => {
    expect(getTaskSection(task("t3", { pinned: true, dueDate: "2999-01-01" }))).toBe("pinned");
  });

  it("classifies everything else as incomplete", () => {
    expect(getTaskSection(task("t4"))).toBe("incomplete");
    expect(getTaskSection(task("t5", { stateType: "started" }))).toBe("incomplete");
    expect(getTaskSection(task("t6", { stateType: "triage" }))).toBe("incomplete");
  });

  it("hides canceled and duplicate tasks", () => {
    expect(getTaskSection(task("t7", { stateType: "canceled" }))).toBe("hidden");
    expect(getTaskSection(task("t8", { stateType: "duplicate" }))).toBe("hidden");
  });
});

describe("groupTasksBySection", () => {
  it("groups tasks into their sections and drops hidden ones", () => {
    const tasks = [
      task("outdated", { dueDate: "2000-01-01" }),
      task("pinned", { pinned: true, dueDate: "2999-01-01" }),
      task("incomplete"),
      task("complete", { stateType: "completed" }),
      task("canceled", { stateType: "canceled" }),
    ];

    const sections = groupTasksBySection(tasks);

    expect(sections.outdated.map((t) => t.id)).toEqual(["outdated"]);
    expect(sections.pinned.map((t) => t.id)).toEqual(["pinned"]);
    expect(sections.incomplete.map((t) => t.id)).toEqual(["incomplete"]);
    expect(sections.complete.map((t) => t.id)).toEqual(["complete"]);
  });
});
