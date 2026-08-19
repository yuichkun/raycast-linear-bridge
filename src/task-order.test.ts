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
    archivedLocally: false,
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

  it("orders sections by urgency, not Linear's own board order: started -> unstarted -> triage -> backlog", () => {
    const backlog = task("b", { stateId: "s2", stateName: "Backlog", stateType: "backlog" });
    const triage = task("tr", { stateId: "s4", stateName: "Triage", stateType: "triage" });
    const unstarted = task("u", { stateId: "s3", stateName: "Todo", stateType: "unstarted" });
    const started = task("s", { stateId: "s1", stateName: "In Progress", stateType: "started" });

    const sections = groupTasksBySection([backlog, triage, unstarted, started]);
    const stateSections = sections.filter((s) => s.key !== "outdated" && s.key !== "complete");

    // What's already being worked on should surface above what hasn't been started,
    // which should surface above what's just sitting in the backlog — the reverse of
    // Linear's own backlog->done board column order.
    expect(stateSections.map((s) => s.title)).toEqual(["In Progress", "Todo", "Triage", "Backlog"]);
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

  it("merges same-named states across different teams into one section (not one per team)", () => {
    // Linear duplicates each workflow state per team under the hood — same name,
    // different stateId. Two teams' "Backlog" must not become two "Backlog" sections.
    const generalBacklog = task("g", {
      stateId: "general-backlog-id",
      stateName: "Backlog",
      stateType: "backlog",
      teamId: "team-general",
    });
    const suaraBacklog = task("s", {
      stateId: "suara-backlog-id",
      stateName: "Backlog",
      stateType: "backlog",
      teamId: "team-suara",
    });

    const sections = groupTasksBySection([generalBacklog, suaraBacklog]);
    const stateSections = sections.filter((s) => s.key !== "outdated" && s.key !== "complete");

    expect(stateSections).toHaveLength(1);
    expect(stateSections[0].title).toBe("Backlog");
    expect(stateSections[0].tasks.map((t) => t.id).sort()).toEqual(["g", "s"]);
  });

  it("uses the lower position when the same-named state has different positions per team", () => {
    const higherPosition = task("h", {
      stateId: "team-a-pending",
      stateName: "Pending",
      stateType: "started",
      statePosition: 5,
    });
    const lowerPosition = task("l", {
      stateId: "team-b-pending",
      stateName: "Pending",
      stateType: "started",
      statePosition: 1,
    });
    const inProgress = task("ip", {
      stateId: "in-progress-id",
      stateName: "In Progress",
      stateType: "started",
      statePosition: 0,
    });

    // Feed the higher-position one first to make sure it doesn't "win" by being seen first.
    const sections = groupTasksBySection([higherPosition, inProgress, lowerPosition]);
    const stateSections = sections.filter((s) => s.key !== "outdated" && s.key !== "complete");

    // Both "Pending" entries collapse to position 1 (the lower of 5 and 1), which still
    // sorts after "In Progress" (position 0) within the same "started" type.
    expect(stateSections.map((s) => s.title)).toEqual(["In Progress", "Pending"]);
  });
});
