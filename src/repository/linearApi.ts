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

// Note: `startWorkflowStateId` is NOT a queryable field on Team in Linear's schema — the
// SDK's own Team.startWorkflowStateId getter derives it from a nested `startWorkflowState
// { id }` object (confirmed by reading the compiled SDK's Team fragment). Query it nested.
//
// Also fetches each team's labels here (not lazily when opening the label-change form) so
// that the offline-first guarantee holds for label editing too — the choices need to come
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
        startWorkflowState {
          id
          name
          type
          position
        }
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
      startWorkflowState: RawState | null;
      states: { nodes: RawState[] };
      labels: { nodes: RawLabel[] };
    }[];
  };
};

export type TeamMetadata = {
  name: string;
  doneState?: RawState;
  startState?: RawState;
  states: RawState[];
  labels: RawLabel[];
};

// `team.startWorkflowState` is nullable, and some teams (e.g. one in this workspace, which
// has both a "Pending" and an "In Progress" state under the "started" category) don't have
// it configured at all — Linear only auto-assigns it unambiguously when a team has a single
// started-type state. Falling back to the started-type state with the lowest position keeps
// "Mark as in Progress" working instead of silently having nowhere to send the task.
export function resolveStartState(states: RawState[], explicitStartState: RawState | null): RawState | undefined {
  if (explicitStartState) return explicitStartState;
  return [...states].filter((state) => state.type === "started").sort((a, b) => a.position - b.position)[0];
}

async function fetchTeamMetadata(client: LinearClient): Promise<Map<string, TeamMetadata>> {
  const result = await client.client.request<TeamMetadataQueryResult, Record<string, never>>(TEAM_METADATA_QUERY);
  const map = new Map<string, TeamMetadata>();
  for (const team of result.teams.nodes) {
    const doneState = team.states.nodes.find((state) => state.type === "completed");
    map.set(team.id, {
      name: team.name,
      doneState,
      startState: resolveStartState(team.states.nodes, team.startWorkflowState),
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

function toTask(node: RawIssueNode, teamMetadata: Map<string, TeamMetadata>): Task {
  const metadata = node.team ? teamMetadata.get(node.team.id) : undefined;

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
    doneStateId: metadata?.doneState?.id,
    doneStateName: metadata?.doneState?.name,
    startStateId: metadata?.startState?.id,
    startStateName: metadata?.startState?.name,
    startStateType: metadata?.startState?.type as WorkflowStateType | undefined,
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

  const tasks = nodes.map((node) => toTask(node, teamMetadata));
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

export async function createIssue(input: CreateIssueInput): Promise<string> {
  const client = getLinearClient();
  const payload = await client.createIssue(input);
  const issue = await payload.issue;
  if (!issue) throw new Error("Linear did not return the created issue");
  return issue.id;
}
