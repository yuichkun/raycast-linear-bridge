import { describe, expect, it } from "vitest";
import { labelOptionsFor, statusOptionsFor } from "./formOptions";
import { Task } from "./types";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    syncState: "synced",
    title: "Task",
    priority: 0,
    labelIds: [],
    labelNames: [],
    archivedLocally: false,
    ...overrides,
  };
}

describe("statusOptionsFor", () => {
  it("lists the team's states in workflow order", () => {
    const options = statusOptionsFor(task({ stateId: "todo" }), [
      { id: "done", name: "Done", type: "completed", position: 3 },
      { id: "todo", name: "Todo", type: "unstarted", position: 1 },
    ]);

    expect(options.map((option) => option.id)).toEqual(["todo", "done"]);
  });

  // While "Done" was missing from the cached states, a Done task's Edit form had no item
  // for its own status — saving it, even just to rename, could submit some other status.
  it("includes the task's current state when the team's list lacks it", () => {
    const options = statusOptionsFor(task({ stateId: "done", stateName: "Done" }), [
      { id: "todo", name: "Todo", type: "unstarted", position: 1 },
    ]);

    expect(options).toEqual([
      { id: "done", name: "Done" },
      { id: "todo", name: "Todo" },
    ]);
  });
});

describe("labelOptionsFor", () => {
  it("includes the task's current labels the team's list lacks, so saving keeps them", () => {
    const options = labelOptionsFor(task({ labelIds: ["ws", "own"], labelNames: ["suara", "LAPRAS"] }), [
      { id: "own", name: "LAPRAS" },
    ]);

    expect(options).toEqual([
      { id: "own", name: "LAPRAS" },
      { id: "ws", name: "suara" },
    ]);
  });
});
