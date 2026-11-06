import { LinearError } from "@linear/sdk";
import type { LinearClient } from "@linear/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLinearClient } from "../linear/client";
import { graphqlError, networkFailure, offline } from "../test/linearErrors";
import {
  createComment,
  createIssue,
  fetchAssignedIssues,
  RawCommentNode,
  resolveStateOfType,
  toIssueComment,
  updateIssueField,
} from "./linearApi";
import { isLinearUnreachable } from "./linearErrors";

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
      createIssue: vi.fn(async () => Promise.reject(offline())),
      issue: vi.fn(async () => Promise.reject(offline())),
    });

    const failure = await createIssue("temp-1", { teamId: "team-1", title: "T" }).catch((error) => error);

    expect(isLinearUnreachable(failure)).toBe(true);
  });

  // Guessing "doesn't exist" here hands processQueue the create's own refusal, which it
  // rolls back — for an issue that may well exist.
  it("surfaces a rate limit during the existence check instead of guessing", async () => {
    const rateLimited = graphqlError("ratelimited", "Rate limit exceeded");
    mockClient({
      createIssue: vi.fn(async () => Promise.reject(graphqlError("invalid input", "Duplicate id"))),
      issue: vi.fn(async () => Promise.reject(rateLimited)),
    });

    await expect(createIssue("temp-1", { teamId: "team-1", title: "T" })).rejects.toBe(rateLimited);
  });
});

describe("fetchAssignedIssues", () => {
  type Page = { nodes: unknown[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };

  function page(nodes: unknown[], endCursor: string | null = null): Page {
    return { nodes, pageInfo: { hasNextPage: endCursor !== null, endCursor } };
  }

  // Stands in for the raw GraphQL client: each query is answered from its list of pages,
  // picked by the `after` cursor it was sent (no cursor = the first page).
  function mockRequests(pages: {
    teams?: Record<string, Page>;
    workflowStates?: Record<string, Page>;
    issueLabels?: Record<string, Page>;
    issues?: Record<string, Page>;
    issueLabelsPage?: Record<string, Page>;
  }) {
    const answer = (byCursor: Record<string, Page> | undefined, after: unknown) =>
      byCursor?.[typeof after === "string" ? after : ""] ?? page([]);
    const request = vi.fn(async (query: string, variables: { after?: string }) => {
      if (query.includes("query Teams")) return { teams: answer(pages.teams, variables.after) };
      if (query.includes("query WorkflowStates")) {
        return { workflowStates: answer(pages.workflowStates, variables.after) };
      }
      if (query.includes("query IssueLabels(")) return { issueLabels: answer(pages.issueLabels, variables.after) };
      if (query.includes("query IssueLabelsPage")) {
        return { issue: { labels: answer(pages.issueLabelsPage, variables.after) } };
      }
      if (query.includes("query AssignedIssues")) return { issues: answer(pages.issues, variables.after) };
      throw new Error(`unexpected query: ${query.slice(0, 40)}`);
    });
    mockClient({ client: { request } });
    return request;
  }

  const general = { id: "general", name: "General" };
  const suara = { id: "suara", name: "SUARA" };

  function state(id: string, type: string, position: number, teamId = "general") {
    return { id, name: id, type, position, team: { id: teamId } };
  }

  // The bug: states were fetched with `first: 20` and no paging. General has 21 states,
  // and "Done" fell outside the first 20, so Mark as Complete picked the next completed
  // state it could see.
  it("reads states to the last page, so a team's 21st state isn't dropped", async () => {
    const first20 = Array.from({ length: 20 }, (_, i) => state(`state-${i}`, "started", 10 + i));
    mockRequests({
      teams: { "": page([general]) },
      workflowStates: { "": page(first20, "cursor-1"), "cursor-1": page([state("Done", "completed", 3)]) },
    });

    const { teamStates } = await fetchAssignedIssues();

    expect(teamStates.get("general")).toHaveLength(21);
    expect(resolveStateOfType(teamStates.get("general") ?? [], "completed")?.id).toBe("Done");
  });

  it("files each state under its own team", async () => {
    mockRequests({
      teams: { "": page([general, suara]) },
      workflowStates: { "": page([state("g-done", "completed", 3), state("s-done", "completed", 3, "suara")]) },
    });

    const { teamStates } = await fetchAssignedIssues();

    expect(teamStates.get("general")?.map((s) => s.id)).toEqual(["g-done"]);
    expect(teamStates.get("suara")?.map((s) => s.id)).toEqual(["s-done"]);
  });

  it("reads every page of teams and labels too", async () => {
    mockRequests({
      teams: { "": page([general], "t-1"), "t-1": page([suara]) },
      issueLabels: {
        "": page([{ id: "l1", name: "One", isGroup: false, team: null }], "l-1"),
        "l-1": page([{ id: "l2", name: "Two", isGroup: false, team: null }]),
      },
    });

    const { teams, teamLabels } = await fetchAssignedIssues();

    expect(teams).toEqual([general, suara]);
    expect(teamLabels.get("suara")?.map((l) => l.id)).toEqual(["l1", "l2"]);
  });

  // Team.labels leaves out workspace labels — and those (suara, den-kit, ...) are on most of
  // this workspace's issues.
  it("offers every team the workspace's labels plus its own, but no other team's and no label groups", async () => {
    mockRequests({
      teams: { "": page([general, suara]) },
      issueLabels: {
        "": page([
          { id: "workspace", name: "suara", isGroup: false, team: null },
          { id: "general-own", name: "LAPRAS", isGroup: false, team: { id: "general" } },
          { id: "suara-own", name: "実装", isGroup: false, team: { id: "suara" } },
          { id: "group", name: "Area", isGroup: true, team: { id: "general" } },
        ]),
      },
    });

    const { teamLabels } = await fetchAssignedIssues();

    expect(teamLabels.get("general")).toEqual([
      { id: "workspace", name: "suara" },
      { id: "general-own", name: "LAPRAS" },
    ]);
    expect(teamLabels.get("suara")).toEqual([
      { id: "workspace", name: "suara" },
      { id: "suara-own", name: "実装" },
    ]);
  });

  it("fails rather than stopping early when a page claims more results but gives no cursor", async () => {
    mockRequests({
      teams: { "": page([general]) },
      workflowStates: { "": { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } } },
    });

    await expect(fetchAssignedIssues()).rejects.toThrow();
  });

  function issueWithLabels(labelCount: number) {
    return {
      id: "issue-1",
      title: "T",
      description: null,
      dueDate: null,
      priority: 0,
      url: "https://linear.app/x/issue/X-1",
      state: null,
      team: null,
      labels: { nodes: Array.from({ length: labelCount }, (_, i) => ({ id: `l${i}`, name: `L${i}` })) },
    };
  }

  // The inline labels page is 50 and has no pageInfo (that would push the issues query past
  // Linear's complexity cap), so a full page is the sign there may be more.
  it("reads all of an issue's labels when they fill the page read inline", async () => {
    const all = Array.from({ length: 51 }, (_, i) => ({ id: `l${i}`, name: `L${i}` }));
    const request = mockRequests({
      issues: { "": page([issueWithLabels(50)]) },
      issueLabelsPage: { "": page(all.slice(0, 30), "more"), more: page(all.slice(30)) },
    });

    const { tasks } = await fetchAssignedIssues();

    expect(tasks[0].labelIds).toHaveLength(51);
    expect(tasks[0].labelNames[50]).toBe("L50");
    expect(request.mock.calls.filter(([query]) => query.includes("query IssueLabelsPage"))).toHaveLength(2);
  });

  it("makes no extra request for an issue whose labels didn't fill the inline page", async () => {
    const request = mockRequests({ issues: { "": page([issueWithLabels(49)]) } });

    const { tasks } = await fetchAssignedIssues();

    expect(tasks[0].labelIds).toHaveLength(49);
    expect(request.mock.calls.some(([query]) => query.includes("query IssueLabelsPage"))).toBe(false);
  });

  // The raw client throws fetch's TypeError, or its own error class; these come back as the
  // SDK's typed errors so the sync can tell "offline" from "refused".
  it("hands back a failed request as one of the SDK's typed errors", async () => {
    mockClient({ client: { request: vi.fn(async () => Promise.reject(networkFailure())) } });

    const failure = await fetchAssignedIssues().catch((error) => error);

    expect(failure).toBeInstanceOf(LinearError);
    expect(isLinearUnreachable(failure)).toBe(true);
  });
});

describe("updateIssueField", () => {
  // The bug: a cleared due date or description was sent as undefined, which the request
  // body leaves out — Linear got an empty update, accepted it, and the old value came back.
  it("sends a cleared field as null, which is how Linear is told to clear it", async () => {
    const updateIssue = vi.fn(async () => ({}));
    mockClient({ updateIssue });

    await updateIssueField("issue-1", "dueDate", undefined);

    expect(updateIssue).toHaveBeenCalledWith("issue-1", { dueDate: null });
  });

  it("sends a set field as it is", async () => {
    const updateIssue = vi.fn(async () => ({}));
    mockClient({ updateIssue });

    await updateIssueField("issue-1", "dueDate", "2026-11-10");

    expect(updateIssue).toHaveBeenCalledWith("issue-1", { dueDate: "2026-11-10" });
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
