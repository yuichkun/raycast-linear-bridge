import type { LinearClient } from "@linear/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLinearClient } from "../linear/client";
import { createComment, createIssue, RawCommentNode, resolveStateOfType, toIssueComment } from "./linearApi";

vi.mock("../linear/client", () => ({
  getLinearClient: vi.fn(),
}));

function mockClient(overrides: Record<string, unknown> = {}) {
  const client = {
    viewer: Promise.resolve({ id: "viewer-1" }),
    createIssue: vi.fn(async () => ({ issue: Promise.resolve({ id: "temp-1" }) })),
    issue: vi.fn(async () => ({ id: "temp-1" })),
    createComment: vi.fn(async () => ({})),
    comment: vi.fn(async () => ({ id: "op-1" })),
    ...overrides,
  };
  vi.mocked(getLinearClient).mockReturnValue(client as unknown as LinearClient);
  return client;
}

beforeEach(() => {
  vi.mocked(getLinearClient).mockReset();
});

describe("createIssue", () => {
  it("sends the tempId as the issue's id and assigns it to the viewer", async () => {
    const client = mockClient();

    const id = await createIssue("temp-1", { teamId: "team-1", title: "T" });

    expect(client.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({ id: "temp-1", teamId: "team-1", title: "T", assigneeId: "viewer-1" }),
    );
    expect(id).toBe("temp-1");
  });

  // The duplicate-issue guard: a create resent after Linear already accepted it (an
  // overlapping sync in another process, or a teardown between send and dequeue) is
  // refused because the id exists — which is success, not a failure to roll back.
  it("treats a refused create as success when an issue with that id already exists", async () => {
    mockClient({ createIssue: vi.fn(async () => Promise.reject(new Error("duplicate id"))) });

    await expect(createIssue("temp-1", { teamId: "team-1", title: "T" })).resolves.toBe("temp-1");
  });

  it("rethrows a refused create when no issue with that id exists", async () => {
    mockClient({
      createIssue: vi.fn(async () => Promise.reject(new Error("Argument Validation Error"))),
      issue: vi.fn(async () => Promise.reject(new Error("Entity not found"))),
    });

    await expect(createIssue("temp-1", { teamId: "team-1", title: "T" })).rejects.toThrow("Argument Validation Error");
  });

  it("surfaces a network failure during the existence check instead of guessing", async () => {
    mockClient({
      createIssue: vi.fn(async () => Promise.reject(new Error("fetch failed"))),
      issue: vi.fn(async () => Promise.reject(new Error("fetch failed"))),
    });

    await expect(createIssue("temp-1", { teamId: "team-1", title: "T" })).rejects.toThrow("fetch failed");
  });
});

describe("createComment", () => {
  it("sends the op id as the comment's id", async () => {
    const client = mockClient();

    await createComment("op-1", "issue-1", "hi");

    expect(client.createComment).toHaveBeenCalledWith({ id: "op-1", issueId: "issue-1", body: "hi" });
  });

  it("treats a refused create as success when a comment with that id already exists", async () => {
    mockClient({ createComment: vi.fn(async () => Promise.reject(new Error("duplicate id"))) });

    await expect(createComment("op-1", "issue-1", "hi")).resolves.toBeUndefined();
  });

  it("rethrows a refused create when no comment with that id exists", async () => {
    mockClient({
      createComment: vi.fn(async () => Promise.reject(new Error("Argument Validation Error"))),
      comment: vi.fn(async () => Promise.reject(new Error("Entity not found"))),
    });

    await expect(createComment("op-1", "issue-1", "hi")).rejects.toThrow("Argument Validation Error");
  });
});

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
