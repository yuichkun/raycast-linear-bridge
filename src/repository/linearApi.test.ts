import { describe, expect, it } from "vitest";
import { resolveStateOfType } from "./linearApi";

describe("resolveStateOfType", () => {
  // The bug this guards against: this workspace's "General" team has two started-type
  // states ("Pending" and "In Progress"). Position picks a single deterministic winner
  // instead of leaving "Mark as in Progress" with nowhere to send the task.
  it("returns the lowest-position state of the given type", () => {
    const pending = { id: "s2", name: "Pending", type: "started", position: 5 };
    const inProgress = { id: "s1", name: "In Progress", type: "started", position: 0 };
    const todo = { id: "s3", name: "Todo", type: "unstarted", position: 0 };

    expect(resolveStateOfType([pending, todo, inProgress], "started")).toBe(inProgress);
  });

  it("returns undefined when the team has no state of that type", () => {
    const todo = { id: "s3", name: "Todo", type: "unstarted", position: 0 };

    expect(resolveStateOfType([todo], "started")).toBeUndefined();
  });

  it("works for any workflow state type, not just started", () => {
    const backlog = { id: "s1", name: "Backlog", type: "backlog", position: 0 };
    const done = { id: "s2", name: "Done", type: "completed", position: 0 };

    expect(resolveStateOfType([backlog, done], "completed")).toBe(done);
  });
});
