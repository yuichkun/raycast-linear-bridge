import { describe, expect, it } from "vitest";
import { searchItems } from "./search";
import { Task } from "./types";

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    syncState: "synced",
    title: id,
    priority: 0,
    labelIds: [],
    labelNames: [],
    archivedLocally: false,
    ...overrides,
  };
}

describe("searchItems", () => {
  it("matches only local-only tasks when searching for 'local'", () => {
    const local = task("l", { syncState: "local", title: "Buy milk" });
    const synced = task("s", { syncState: "synced", title: "Ship feature" });
    const pending = task("p", { syncState: "pendingCreate", title: "Write doc" });

    const result = searchItems([local, synced, pending], "local");

    expect(result.map((t) => t.id)).toEqual(["l"]);
  });
});
