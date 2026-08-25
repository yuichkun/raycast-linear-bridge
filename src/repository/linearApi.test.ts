import { describe, expect, it } from "vitest";
import { RawCommentNode, resolveStateOfType, toIssueComment } from "./linearApi";

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

describe("toIssueComment", () => {
  function node(overrides: Partial<RawCommentNode> = {}): RawCommentNode {
    return {
      id: "c1",
      body: "hi",
      createdAt: "2026-08-21T00:00:00.000Z",
      editedAt: null,
      parentId: null,
      resolvedAt: null,
      resolvingCommentId: null,
      quotedText: null,
      reactions: [],
      user: null,
      botActor: null,
      externalUser: null,
      ...overrides,
    };
  }

  it("takes the author from the workspace user first", () => {
    const comment = toIssueComment(
      node({ user: { name: "Yogo", displayName: "yogo" }, botActor: { name: "Linear", userDisplayName: null } }),
    );

    expect(comment.authorName).toBe("Yogo");
  });

  it("falls back to the bot actor, then to its display name", () => {
    expect(toIssueComment(node({ botActor: { name: "Watari Nudge", userDisplayName: null } })).authorName).toBe(
      "Watari Nudge",
    );
    expect(toIssueComment(node({ botActor: { name: null, userDisplayName: "watari" } })).authorName).toBe("watari");
  });

  it("falls back to an external user on a synced Slack/email thread", () => {
    expect(toIssueComment(node({ externalUser: { name: "Client A", displayName: "client-a" } })).authorName).toBe(
      "Client A",
    );
  });

  it("labels a comment with no identity at all as Unknown", () => {
    expect(toIssueComment(node()).authorName).toBe("Unknown");
  });

  it("counts reactions per emoji in first-seen order", () => {
    const comment = toIssueComment(node({ reactions: [{ emoji: "👍" }, { emoji: "🎉" }, { emoji: "👍" }] }));

    expect(comment.reactions).toEqual([
      { emoji: "👍", count: 2 },
      { emoji: "🎉", count: 1 },
    ]);
  });

  it("maps null fields to undefined and keeps set ones", () => {
    const comment = toIssueComment(
      node({
        parentId: "root",
        resolvingCommentId: null,
        quotedText: "some text",
        editedAt: "2026-08-22T00:00:00.000Z",
      }),
    );

    expect(comment.parentId).toBe("root");
    expect(comment.resolvingCommentId).toBeUndefined();
    expect(comment.resolvedAt).toBeUndefined();
    expect(comment.quotedText).toBe("some text");
    expect(comment.editedAt).toBe("2026-08-22T00:00:00.000Z");
  });
});
