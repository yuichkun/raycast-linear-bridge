import { describe, expect, it } from "vitest";
import { classifyTask, groupTasksBySection, restrictToDueHorizon, restrictToVisibleTeams } from "./task-order";
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

describe("restrictToVisibleTeams", () => {
  it("shows everything when the selection is empty", () => {
    const tasks = [task("a", { teamId: "team-x" }), task("b")];

    expect(restrictToVisibleTeams(tasks, [])).toEqual(tasks);
  });

  it("keeps only tasks from the selected teams", () => {
    const tasks = [task("a", { teamId: "team-x" }), task("b", { teamId: "team-y" }), task("c", { teamId: "team-x" })];

    const result = restrictToVisibleTeams(tasks, ["team-y"]);

    expect(result.map((t) => t.id)).toEqual(["b"]);
  });

  it("always keeps local-only tasks with no teamId, whatever the selection", () => {
    const localOnly = task("local", { syncState: "local", teamId: undefined });

    const result = restrictToVisibleTeams([localOnly, task("a", { teamId: "team-x" })], ["team-y"]);

    expect(result.map((t) => t.id)).toEqual(["local"]);
  });

  it("applies to completed and overdue tasks too, not just active sections", () => {
    const doneFiltered = task("done", { teamId: "team-x", stateType: "completed" });
    const overdueFiltered = task("overdue", { teamId: "team-x", dueDate: "2000-01-01" });

    expect(restrictToVisibleTeams([doneFiltered, overdueFiltered], ["team-y"])).toEqual([]);
  });
});

describe("restrictToDueHorizon", () => {
  // Sunday night, end of the month: the moment the calendar-based horizons went blind.
  const now = new Date(2026, 7, 30, 23, 59); // Sun 2026-08-30, local time
  const undated = task("undated");
  const overdue = task("overdue", { dueDate: "2000-01-01" });
  const yesterday = task("yesterday", { dueDate: "2026-08-29" });
  const today = task("today", { dueDate: "2026-08-30" });
  const tomorrow = task("tomorrow", { dueDate: "2026-08-31" }); // Monday, and the last day of the month
  const inSevenDays = task("in-7", { dueDate: "2026-09-06" });
  const inEightDays = task("in-8", { dueDate: "2026-09-07" });
  const inThirtyDays = task("in-30", { dueDate: "2026-09-29" });
  const inThirtyOneDays = task("in-31", { dueDate: "2026-09-30" });
  const all = [undated, overdue, yesterday, today, tomorrow, inSevenDays, inEightDays, inThirtyDays, inThirtyOneDays];
  const ids = (tasks: Task[]) => tasks.map((t) => t.id);

  it("shows everything for all", () => {
    expect(restrictToDueHorizon(all, "all", now)).toEqual(all);
  });

  it("keeps undated, overdue, and same-day tasks for today, dropping tomorrow", () => {
    expect(ids(restrictToDueHorizon(all, "today", now))).toEqual(["undated", "overdue", "yesterday", "today"]);
  });

  it("on a Sunday, 7days still shows Monday's deadline and everything through day +7", () => {
    expect(ids(restrictToDueHorizon(all, "7days", now))).toEqual([
      "undated",
      "overdue",
      "yesterday",
      "today",
      "tomorrow",
      "in-7",
    ]);
  });

  it("on the eve of a new month, 30days still shows the 1st and everything through day +30", () => {
    expect(ids(restrictToDueHorizon(all, "30days", now))).toEqual([
      "undated",
      "overdue",
      "yesterday",
      "today",
      "tomorrow",
      "in-7",
      "in-8",
      "in-30",
    ]);
  });

  it("treats the window edge as inclusive: exactly +7 and +30 stay, +8 and +31 go", () => {
    expect(ids(restrictToDueHorizon([inSevenDays, inEightDays], "7days", now))).toEqual(["in-7"]);
    expect(ids(restrictToDueHorizon([inThirtyDays, inThirtyOneDays], "30days", now))).toEqual(["in-30"]);
  });

  it("keeps the same window across a year boundary", () => {
    const newYearsEve = new Date(2026, 11, 31, 23, 59);
    const jan7 = task("jan-7", { dueDate: "2027-01-07" });
    const jan8 = task("jan-8", { dueDate: "2027-01-08" });
    const jan30 = task("jan-30", { dueDate: "2027-01-30" });
    const jan31 = task("jan-31", { dueDate: "2027-01-31" });

    expect(ids(restrictToDueHorizon([jan7, jan8], "7days", newYearsEve))).toEqual(["jan-7"]);
    expect(ids(restrictToDueHorizon([jan30, jan31], "30days", newYearsEve))).toEqual(["jan-30"]);
  });

  it("hides completed tasks under any horizon, even ones due today, overdue, or undated", () => {
    const doneToday = task("done-today", { stateType: "completed", dueDate: "2026-08-30" });
    const doneOverdue = task("done-overdue", { stateType: "completed", dueDate: "2000-01-01" });
    const doneUndated = task("done-undated", { stateType: "completed" });

    expect(restrictToDueHorizon([doneToday, doneOverdue, doneUndated], "today", now)).toEqual([]);
    expect(restrictToDueHorizon([doneToday, doneOverdue, doneUndated], "7days", now)).toEqual([]);
    expect(restrictToDueHorizon([doneToday, doneOverdue, doneUndated], "30days", now)).toEqual([]);
  });

  it("keeps completed tasks under all", () => {
    const doneUndated = task("done-undated", { stateType: "completed" });

    expect(restrictToDueHorizon([doneUndated], "all", now)).toEqual([doneUndated]);
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
    // Distinct emoji even though both share a stateType — same emoji would visually
    // re-merge sections that were deliberately split apart to stay distinguishable.
    expect(stateSections.map((s) => s.title)).toEqual(["🔥 In Progress", "⚡ Pending"]);
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
    expect(stateSections.map((s) => s.title)).toEqual(["🔥 In Progress", "📝 Todo", "📥 Triage", "🗂️ Backlog"]);
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
    expect(stateSections[0].title).toBe("🗂️ Backlog");
    expect(stateSections[0].tasks.map((t) => t.id).sort()).toEqual(["g", "s"]);
  });

  // The sort key used to be type * 1_000_000 + position, which put a state with a position of
  // a million or more after every state of the next type.
  it("keeps the type order whatever size the positions are", () => {
    const started = task("s", { stateName: "Long Running", stateType: "started", statePosition: 2_500_000 });
    const unstarted = task("u", { stateName: "Todo", stateType: "unstarted", statePosition: 1 });

    const sections = groupTasksBySection([unstarted, started]);
    const stateSections = sections.filter((s) => s.key !== "outdated" && s.key !== "complete");

    expect(stateSections.map((s) => s.key)).toEqual(["Long Running", "Todo"]);
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
    expect(stateSections.map((s) => s.title)).toEqual(["🔥 In Progress", "⚡ Pending"]);
  });

  it("gives same-type sections distinct emoji instead of visually re-merging them", () => {
    const pending = task("p", { stateId: "s1", stateName: "Pending", stateType: "started", statePosition: 0 });
    const inProgress = task("ip", {
      stateId: "s2",
      stateName: "In Progress",
      stateType: "started",
      statePosition: 1,
    });
    const reviewing = task("r", { stateId: "s3", stateName: "Reviewing", stateType: "started", statePosition: 2 });

    const sections = groupTasksBySection([pending, inProgress, reviewing]);
    const stateSections = sections.filter((s) => s.key !== "outdated" && s.key !== "complete");
    const emojis = stateSections.map((s) => s.title.split(" ")[0]);

    expect(new Set(emojis).size).toBe(emojis.length);
  });

  it("sorts the New section (local-only/pending tasks with no real state yet) before every other dynamic section", () => {
    // createTask gives local-only/pendingCreate tasks stateName: "New" and no stateType
    // at all — see storage.ts. This should always surface first among dynamic sections,
    // not sink to the bottom behind Backlog just because it has no recognized type.
    const backlog = task("b", { stateId: "s2", stateName: "Backlog", stateType: "backlog" });
    const started = task("s", { stateId: "s1", stateName: "In Progress", stateType: "started" });
    const newTask = task("n", { stateId: undefined, stateName: "New", stateType: undefined });

    const sections = groupTasksBySection([backlog, started, newTask]);
    const stateSections = sections.filter((s) => s.key !== "outdated" && s.key !== "complete");

    expect(stateSections.map((s) => s.title)).toEqual(["🆕 New", "🔥 In Progress", "🗂️ Backlog"]);
  });
});
