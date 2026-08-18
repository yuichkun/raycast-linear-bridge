import { LinearClient } from "@linear/sdk";
import { getLinearClient } from "../linear/client";
import { Task, WorkflowStateType } from "../types";
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
const TEAM_STATE_IDS_QUERY = `
  query TeamStateIds {
    teams(first: 50) {
      nodes {
        id
        startWorkflowState {
          id
          name
          type
        }
        states(first: 50) {
          nodes {
            id
            name
            type
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

type RawState = { id: string; name: string; type: string };

type TeamStateIdsQueryResult = {
  teams: {
    nodes: {
      id: string;
      startWorkflowState: RawState | null;
      states: { nodes: RawState[] };
    }[];
  };
};

type TeamStateIds = { doneState?: RawState; startState?: RawState };

async function fetchTeamStateIds(client: LinearClient): Promise<Map<string, TeamStateIds>> {
  const result = await client.client.request<TeamStateIdsQueryResult, Record<string, never>>(TEAM_STATE_IDS_QUERY);
  const map = new Map<string, TeamStateIds>();
  for (const team of result.teams.nodes) {
    const doneState = team.states.nodes.find((state) => state.type === "completed");
    map.set(team.id, {
      doneState,
      startState: team.startWorkflowState ?? undefined,
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

function toTask(node: RawIssueNode, teamStateIds: Map<string, TeamStateIds>): Task {
  const ids = node.team ? teamStateIds.get(node.team.id) : undefined;

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
    doneStateId: ids?.doneState?.id,
    doneStateName: ids?.doneState?.name,
    startStateId: ids?.startState?.id,
    startStateName: ids?.startState?.name,
    startStateType: ids?.startState?.type as WorkflowStateType | undefined,
    teamId: node.team?.id,
    teamName: node.team?.name,
    labelIds: node.labels.nodes.map((label) => label.id),
    labelNames: node.labels.nodes.map((label) => label.name),
    url: node.url,
  };
}

export async function fetchAssignedIssues(): Promise<Task[]> {
  const client = getLinearClient();
  const viewer = await client.viewer;

  const [teamStateIds, nodes] = await Promise.all([fetchTeamStateIds(client), fetchAllIssueNodes(client, viewer.id)]);

  return nodes.map((node) => toTask(node, teamStateIds));
}

export async function updateIssueField(issueId: string, field: SyncOpField, value: unknown): Promise<void> {
  const client = getLinearClient();
  await client.updateIssue(issueId, { [field]: value });
}
