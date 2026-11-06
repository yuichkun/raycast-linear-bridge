import { LinearClient, parseLinearError } from "@linear/sdk";
import { getLinearClient } from "../linear/client";
import { CommentReaction, CreateIssueInput, IssueComment, Task, WorkflowStateType } from "../types";
import { shouldRetryLater } from "./linearErrors";
import { SyncOpField } from "./syncQueue";

type PageInfo = { hasNextPage: boolean; endCursor: string | null };
type Connection<T> = { nodes: T[]; pageInfo: PageInfo };

// Linear's largest page size.
const PAGE_SIZE = 250;

// Every list this extension reads from Linear is read to its last page. A fixed `first: N`
// with no cursor silently drops whatever comes after the Nth node: that is how a team's 21st
// workflow state pushed "Done" out of the cached states, so Mark as Complete moved tasks to
// whichever other completed state came first. A page that claims more results but gives no
// cursor to fetch them with is an error rather than a reason to stop early or loop forever.
async function fetchAllPages<T>(fetchPage: (after: string | undefined) => Promise<Connection<T>>): Promise<T[]> {
  const nodes: T[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await fetchPage(after);
    nodes.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) return nodes;
    if (!page.pageInfo.endCursor) throw new Error("Linear reported another page but gave no cursor for it");
    after = page.pageInfo.endCursor;
  }
}

// The raw GraphQL client below the SDK throws its own error class (or fetch's TypeError when
// there is no response at all); the SDK's typed methods wrap theirs with parseLinearError.
// Doing the same here means every failure from Linear reaches the caller as a LinearError,
// so linearErrors.ts can classify it the same way wherever it came from.
async function request<T>(client: LinearClient, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  try {
    return await client.client.request<T, Record<string, unknown>>(query, variables);
  } catch (error) {
    throw parseLinearError(error as Parameters<typeof parseLinearError>[0]);
  }
}

// How many of an issue's labels ISSUES_QUERY reads inline — Linear's default page size, so
// the query costs what it did before it named one. An issue with exactly this many may have
// more, and gets the rest read separately (fetchAllIssueNodes).
const INLINE_LABELS = 50;

// Issue.state / Issue.team / Issue.labels() on the SDK's high-level Issue class each
// resolve via a separate GraphQL request (confirmed by reading the compiled SDK), which
// turns fetching N issues into 1 + 3N requests and quickly exhausts Linear's rate limit
// (2500 req/hour). Querying `issues` directly with nested field selections keeps this to
// a small, constant number of requests regardless of how many issues are assigned.
//
// The query's complexity score is capped at 10000, and by Linear's documented scoring
// everything inside a connection counts once per item it can return — inside `labels`, once
// per label of every issue. A `pageInfo` there would roughly double the score of a 100-issue
// page, so the labels page carries none, and a full page is what says there may be more.
const ISSUES_QUERY = `
  query AssignedIssues($filter: IssueFilter, $first: Int, $after: String) {
    issues(filter: $filter, first: $first, after: $after) {
      nodes {
        id
        title
        description
        dueDate
        priority
        url
        state {
          id
          name
          type
          position
        }
        team {
          id
          name
        }
        labels(first: ${INLINE_LABELS}) {
          nodes {
            id
            name
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// All of one issue's labels, for the rare issue whose labels fill the page read inline in
// ISSUES_QUERY.
const ISSUE_LABELS_PAGE_QUERY = `
  query IssueLabelsPage($id: String!, $first: Int, $after: String) {
    issue(id: $id) {
      labels(first: $first, after: $after) {
        nodes {
          id
          name
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

// Teams, workflow states and labels are fetched here (not lazily when opening an edit form)
// so that the offline-first guarantee holds for those forms too — the choices need to come
// from the cache, not a live request.
//
// Each is its own flat, top-level connection read to its last page, rather than states and
// labels nested inside `teams`: nested connections can't be paged independently, and their
// page sizes multiply into the query's complexity score (a `first: 250` nested inside
// another `first: 250` tripped the 10000 ceiling in an earlier version). A flat list carries
// each node's team id instead.
const TEAMS_QUERY = `
  query Teams($first: Int, $after: String) {
    teams(first: $first, after: $after) {
      nodes {
        id
        name
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const WORKFLOW_STATES_QUERY = `
  query WorkflowStates($first: Int, $after: String) {
    workflowStates(first: $first, after: $after) {
      nodes {
        id
        name
        type
        position
        team {
          id
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// All labels, not just each team's own: `Team.labels` leaves out workspace-level labels
// (team: null), which are available to every team, so a picker built from it alone couldn't
// show or keep them.
const ISSUE_LABELS_QUERY = `
  query IssueLabels($first: Int, $after: String) {
    issueLabels(first: $first, after: $after) {
      nodes {
        id
        name
        isGroup
        team {
          id
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

type RawIssueLabel = { id: string; name: string };

type RawIssueNode = {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: number;
  url: string;
  state: { id: string; name: string; type: string; position: number } | null;
  team: { id: string; name: string } | null;
  labels: { nodes: RawIssueLabel[] };
};

type IssuesQueryResult = { issues: Connection<RawIssueNode> };
type IssueLabelsPageQueryResult = { issue: { labels: Connection<RawIssueLabel> } };

export type RawState = { id: string; name: string; type: string; position: number };
type RawLabel = { id: string; name: string };

type RawTeamNode = { id: string; name: string };
type RawWorkflowStateNode = RawState & { team: { id: string } };
export type RawLabelNode = RawLabel & { isGroup: boolean; team: { id: string } | null };

type TeamsQueryResult = { teams: Connection<RawTeamNode> };
type WorkflowStatesQueryResult = { workflowStates: Connection<RawWorkflowStateNode> };
type IssueLabelsQueryResult = { issueLabels: Connection<RawLabelNode> };

export type TeamMetadata = {
  name: string;
  states: RawState[];
  labels: RawLabel[];
};

// The single rule for "which state should a task move to for a given category" (started,
// completed, backlog, ...): the first state of that type in the team's workflow, i.e. the
// lowest position — Linear displays the states of each type in ascending position order, so
// this is the one listed first under that type in the team's workflow settings. Used both at
// full-sync time and on-demand (EditTask, Promote to Linear, Mark as Complete/in Progress) so
// there's one place this decision is made, not one per call site. Linear's own automations
// pick "the first Started status" the same way. A team can have several states of one type
// (this workspace's General has both "Pending" and "In Progress" under started, and "Done"
// followed by several 【案件】 states under completed). It only picks from the states it's
// given, which is why the team's state list must be complete (see fetchAllPages).
export function resolveStateOfType(states: RawState[], type: RawState["type"]): RawState | undefined {
  return [...states].filter((state) => state.type === type).sort((a, b) => a.position - b.position)[0];
}

// The labels an issue in a given team can take: the workspace's labels plus that team's own.
// Group labels are left out — Linear doesn't let a group be applied to an issue itself, only
// the labels inside it.
export function labelsAvailableToTeam(labels: RawLabelNode[], teamId: string): RawLabel[] {
  return labels
    .filter((label) => !label.isGroup && (label.team === null || label.team.id === teamId))
    .map(({ id, name }) => ({ id, name }));
}

async function fetchTeamMetadata(client: LinearClient): Promise<Map<string, TeamMetadata>> {
  const [teams, states, labels] = await Promise.all([
    fetchAllPages((after) =>
      request<TeamsQueryResult>(client, TEAMS_QUERY, { first: PAGE_SIZE, after }).then((data) => data.teams),
    ),
    fetchAllPages((after) =>
      request<WorkflowStatesQueryResult>(client, WORKFLOW_STATES_QUERY, { first: PAGE_SIZE, after }).then(
        (data) => data.workflowStates,
      ),
    ),
    fetchAllPages((after) =>
      request<IssueLabelsQueryResult>(client, ISSUE_LABELS_QUERY, { first: PAGE_SIZE, after }).then(
        (data) => data.issueLabels,
      ),
    ),
  ]);

  const statesByTeam = new Map<string, RawState[]>();
  for (const { team, ...state } of states) {
    statesByTeam.set(team.id, [...(statesByTeam.get(team.id) ?? []), state]);
  }

  // Teams keep the order Linear lists them in: pickDefaultTeam falls back to the first one.
  const map = new Map<string, TeamMetadata>();
  for (const team of teams) {
    map.set(team.id, {
      name: team.name,
      states: statesByTeam.get(team.id) ?? [],
      labels: labelsAvailableToTeam(labels, team.id),
    });
  }
  return map;
}

async function fetchAllIssueNodes(client: LinearClient, viewerId: string): Promise<RawIssueNode[]> {
  const nodes = await fetchAllPages((after) =>
    request<IssuesQueryResult>(client, ISSUES_QUERY, {
      filter: { assignee: { id: { eq: viewerId } } },
      first: 100,
      after,
    }).then((data) => data.issues),
  );

  return Promise.all(
    nodes.map(async (node) => {
      if (node.labels.nodes.length < INLINE_LABELS) return node;
      const all = await fetchAllPages((after) =>
        request<IssueLabelsPageQueryResult>(client, ISSUE_LABELS_PAGE_QUERY, {
          id: node.id,
          first: PAGE_SIZE,
          after,
        }).then((data) => data.issue.labels),
      );
      return { ...node, labels: { nodes: all } };
    }),
  );
}

function toTask(node: RawIssueNode): Task {
  return {
    id: node.id,
    syncState: "synced",
    title: node.title,
    description: node.description ?? undefined,
    dueDate: node.dueDate ?? undefined,
    priority: node.priority ?? 0,
    stateId: node.state?.id,
    stateName: node.state?.name,
    stateType: node.state?.type as WorkflowStateType | undefined,
    statePosition: node.state?.position,
    teamId: node.team?.id,
    teamName: node.team?.name,
    labelIds: node.labels.nodes.map((label) => label.id),
    labelNames: node.labels.nodes.map((label) => label.name),
    url: node.url,
    archivedLocally: false,
  };
}

export type TeamOption = { id: string; name: string };

export type FetchAssignedIssuesResult = {
  tasks: Task[];
  teamLabels: Map<string, RawLabel[]>;
  teamStates: Map<string, RawState[]>;
  teams: TeamOption[];
};

export async function fetchAssignedIssues(): Promise<FetchAssignedIssuesResult> {
  const client = getLinearClient();
  const viewer = await client.viewer;

  const [teamMetadata, nodes] = await Promise.all([fetchTeamMetadata(client), fetchAllIssueNodes(client, viewer.id)]);

  const tasks = nodes.map((node) => toTask(node));
  const teamLabels = new Map<string, RawLabel[]>();
  const teamStates = new Map<string, RawState[]>();
  const teams: TeamOption[] = [];
  for (const [teamId, metadata] of teamMetadata) {
    teamLabels.set(teamId, metadata.labels);
    teamStates.set(teamId, metadata.states);
    teams.push({ id: teamId, name: metadata.name });
  }

  return { tasks, teamLabels, teamStates, teams };
}

// A cleared field (no due date, no description) is sent as null, which is how Linear is told
// to clear it. As undefined it never got there: the queue file drops undefined values, and the
// request body would leave the key out anyway, so Linear was sent an empty update, accepted it,
// and the next pull brought the old value back.
export async function updateIssueField(issueId: string, field: SyncOpField, value: unknown): Promise<void> {
  const client = getLinearClient();
  await client.updateIssue(issueId, { [field]: value === undefined ? null : value });
}

export async function archiveIssue(issueId: string): Promise<void> {
  const client = getLinearClient();
  await client.archiveIssue(issueId);
}

// Same idempotency scheme as createIssue below: the queue op's own id (a UUID v4) becomes
// the comment's id on Linear, so a comment op sent twice yields one comment, not two.
export async function createComment(commentId: string, issueId: string, body: string): Promise<void> {
  const client = getLinearClient();
  try {
    await client.createComment({ id: commentId, issueId, body });
  } catch (error) {
    if (await commentExists(client, commentId)) return;
    throw error;
  }
}

// Every issue this extension creates must be assigned to the key's own viewer — the
// entire list is built on an `assignee: me` filter (fetchAllIssueNodes above), so an
// unassigned issue would be created successfully and then immediately vanish from view on
// the next sync. Resolved here (at actual sync time, always online) rather than passed in
// from the caller, so it's not something a future call site can forget to set.
//
// The queued tempId doubles as Linear's issue id (IssueCreateInput.id takes a client-
// supplied UUID v4). That makes creation idempotent: if the same op is ever sent twice —
// two overlapping sync runs, or a process torn down after Linear created the issue but
// before the op was dequeued — Linear refuses the second create, and the existence check
// turns that refusal back into success. Without this, every resend was a fresh issue,
// which is how a single Create Task produced two.
export async function createIssue(tempId: string, input: CreateIssueInput): Promise<string> {
  const client = getLinearClient();
  const viewer = await client.viewer;
  try {
    const payload = await client.createIssue({ ...input, id: tempId, assigneeId: viewer.id });
    const issue = await payload.issue;
    if (!issue) throw new Error("Linear did not return the created issue");
    return issue.id;
  } catch (error) {
    if (await issueExists(client, tempId)) return tempId;
    throw error;
  }
}

async function issueExists(client: LinearClient, id: string): Promise<boolean> {
  try {
    await client.issue(id);
    return true;
  } catch (error) {
    // No answer, or an answer that only says "not now" (rate limit, Linear-side failure):
    // there's no telling either way — surface that so the op is retried, don't guess "no".
    if (shouldRetryLater(error)) throw error;
    return false;
  }
}

async function commentExists(client: LinearClient, id: string): Promise<boolean> {
  try {
    await client.comment({ id });
    return true;
  } catch (error) {
    if (shouldRetryLater(error)) throw error;
    return false;
  }
}

// One request per page of a single issue's comments, with the author identities nested
// in — the SDK's comment.user / .botActor / .externalUser getters would each be a
// separate request, the same N+1 shape ISSUES_QUERY avoids.
const ISSUE_COMMENTS_QUERY = `
  query IssueComments($id: String!, $first: Int, $after: String) {
    issue(id: $id) {
      comments(first: $first, after: $after) {
        nodes {
          id
          body
          createdAt
          editedAt
          parentId
          resolvedAt
          resolvingCommentId
          quotedText
          reactions {
            emoji
          }
          user {
            name
            displayName
          }
          botActor {
            name
            userDisplayName
          }
          externalUser {
            name
            displayName
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

export type RawCommentNode = {
  id: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  parentId: string | null;
  resolvedAt: string | null;
  resolvingCommentId: string | null;
  quotedText: string | null;
  reactions: { emoji: string }[];
  user: { name: string; displayName: string } | null;
  botActor: { name: string | null; userDisplayName: string | null } | null;
  externalUser: { name: string; displayName: string } | null;
};

type IssueCommentsQueryResult = { issue: { comments: Connection<RawCommentNode> } };

// A comment has exactly one author identity: a workspace user, a bot (Linear Agent, an
// integration), or an external person on a synced Slack/email thread. All three have to
// be handled, or that kind of comment renders with a blank author.
function resolveAuthorName(node: RawCommentNode): string {
  if (node.user) return node.user.name || node.user.displayName;
  if (node.botActor) return node.botActor.name || node.botActor.userDisplayName || "Bot";
  if (node.externalUser) return node.externalUser.name || node.externalUser.displayName;
  return "Unknown";
}

function countReactions(reactions: { emoji: string }[]): CommentReaction[] {
  const counts = new Map<string, number>();
  for (const { emoji } of reactions) counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
  return [...counts.entries()].map(([emoji, count]) => ({ emoji, count }));
}

export function toIssueComment(node: RawCommentNode): IssueComment {
  return {
    id: node.id,
    body: node.body,
    createdAt: node.createdAt,
    editedAt: node.editedAt ?? undefined,
    parentId: node.parentId ?? undefined,
    resolvedAt: node.resolvedAt ?? undefined,
    resolvingCommentId: node.resolvingCommentId ?? undefined,
    quotedText: node.quotedText ?? undefined,
    authorName: resolveAuthorName(node),
    reactions: countReactions(node.reactions),
  };
}

export async function fetchIssueComments(issueId: string): Promise<IssueComment[]> {
  const client = getLinearClient();
  const nodes = await fetchAllPages((after) =>
    request<IssueCommentsQueryResult>(client, ISSUE_COMMENTS_QUERY, { id: issueId, first: 50, after }).then(
      (data) => data.issue.comments,
    ),
  );
  return nodes.map(toIssueComment);
}
