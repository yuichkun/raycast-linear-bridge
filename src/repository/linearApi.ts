import { LinearClient } from "@linear/sdk";
import { getLinearClient } from "../linear/client";
import { CreateIssueInput, Task, WorkflowStateType } from "../types";
import { SyncOpField } from "./syncQueue";

// Issue.state / Issue.team / Issue.labels() on the SDK's high-level Issue class each
// resolve via a separate GraphQL request (confirmed by reading the compiled SDK), which
// turns fetching N issues into 1 + 3N requests and quickly exhausts Linear's rate limit
// (2500 req/hour). Querying `issues` directly with nested field selections keeps this to
// a small, constant number of requests regardless of how many issues are assigned.
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
        labels {
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

// Fetches each team's labels and states here (not lazily when opening an edit form) so
// that the offline-first guarantee holds for those forms too — the choices need to come
// from the cache, not a live request. Connection sizes are kept modest (this workspace has
// 6 teams / 8 states / 10 labels) since nested pagination args multiply the GraphQL query's
// complexity score; a naive `first: 250` on multiple nested connections tripped the 10000
// complexity ceiling in an earlier version of this query.
const TEAM_METADATA_QUERY = `
  query TeamMetadata {
    teams(first: 20) {
      nodes {
        id
        name
        states(first: 20) {
          nodes {
            id
            name
            type
            position
          }
        }
        labels(first: 50) {
          nodes {
            id
            name
          }
        }
      }
    }
  }
`;

type RawIssueNode = {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: number;
  url: string;
  state: { id: string; name: string; type: string; position: number } | null;
  team: { id: string; name: string } | null;
  labels: { nodes: { id: string; name: string }[] };
};

type IssuesQueryResult = {
  issues: {
    nodes: RawIssueNode[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

export type RawState = { id: string; name: string; type: string; position: number };
type RawLabel = { id: string; name: string };

type TeamMetadataQueryResult = {
  teams: {
    nodes: {
      id: string;
      name: string;
      states: { nodes: RawState[] };
      labels: { nodes: RawLabel[] };
    }[];
  };
};

export type TeamMetadata = {
  name: string;
  states: RawState[];
  labels: RawLabel[];
};

// The single rule for "which state should a task move to for a given category" (started,
// completed, backlog, ...): lowest position among that team's states of that type. Used
// both at full-sync time and on-demand (EditTask, Promote to Linear, Mark as
// Complete/in Progress) so there's one place this decision is made, not one per call site.
// Some teams (e.g. one in this workspace, which has both a "Pending" and an "In Progress"
// state under "started") have more than one state per category — position picks a single
// winner deterministically.
export function resolveStateOfType(states: RawState[], type: RawState["type"]): RawState | undefined {
  return [...states].filter((state) => state.type === type).sort((a, b) => a.position - b.position)[0];
}

async function fetchTeamMetadata(client: LinearClient): Promise<Map<string, TeamMetadata>> {
  const result = await client.client.request<TeamMetadataQueryResult, Record<string, never>>(TEAM_METADATA_QUERY);
  const map = new Map<string, TeamMetadata>();
  for (const team of result.teams.nodes) {
    map.set(team.id, {
      name: team.name,
      states: team.states.nodes,
      labels: team.labels.nodes,
    });
  }
  return map;
}

async function fetchAllIssueNodes(client: LinearClient, viewerId: string): Promise<RawIssueNode[]> {
  const nodes: RawIssueNode[] = [];
  let after: string | undefined;

  for (;;) {
    const result = await client.client.request<IssuesQueryResult, Record<string, unknown>>(ISSUES_QUERY, {
      filter: { assignee: { id: { eq: viewerId } } },
      first: 100,
      after,
    });
    nodes.push(...result.issues.nodes);
    if (!result.issues.pageInfo.hasNextPage) break;
    after = result.issues.pageInfo.endCursor ?? undefined;
  }

  return nodes;
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

export async function updateIssueField(issueId: string, field: SyncOpField, value: unknown): Promise<void> {
  const client = getLinearClient();
  await client.updateIssue(issueId, { [field]: value });
}

export async function archiveIssue(issueId: string): Promise<void> {
  const client = getLinearClient();
  await client.archiveIssue(issueId);
}

// Every issue this extension creates must be assigned to the key's own viewer — the
// entire list is built on an `assignee: me` filter (fetchAllIssueNodes above), so an
// unassigned issue would be created successfully and then immediately vanish from view on
// the next sync. Resolved here (at actual sync time, always online) rather than passed in
// from the caller, so it's not something a future call site can forget to set.
export async function createIssue(input: CreateIssueInput): Promise<string> {
  const client = getLinearClient();
  const viewer = await client.viewer;
  const payload = await client.createIssue({ ...input, assigneeId: viewer.id });
  const issue = await payload.issue;
  if (!issue) throw new Error("Linear did not return the created issue");
  return issue.id;
}
