import { describe, expect, it } from "vitest";
import { resolveStartState } from "./linearApi";

describe("resolveStartState", () => {
  it("uses the team's explicit startWorkflowState when Linear has one configured", () => {
    const explicit = { id: "s1", name: "In Progress", type: "started", position: 5 };
    const states = [explicit, { id: "s2", name: "Pending", type: "started", position: 0 }];

    expect(resolveStartState(states, explicit)).toBe(explicit);
  });

  // The bug this guards against: this workspace's "General" team has two started-type
  // states ("Pending" and "In Progress"), and Linear leaves startWorkflowState
  // unconfigured (null) in exactly that situation. Without this fallback, "Mark as in
  // Progress" had nowhere to send the task and silently did nothing.
  it("falls back to the lowest-position started-type state when nothing is explicitly configured", () => {
    const pending = { id: "s2", name: "Pending", type: "started", position: 5 };
    const inProgress = { id: "s1", name: "In Progress", type: "started", position: 0 };
    const todo = { id: "s3", name: "Todo", type: "unstarted", position: 0 };

    expect(resolveStartState([pending, todo, inProgress], null)).toBe(inProgress);
  });

  it("returns undefined when the team has no started-type state at all", () => {
    const todo = { id: "s3", name: "Todo", type: "unstarted", position: 0 };

    expect(resolveStartState([todo], null)).toBeUndefined();
  });
});
