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

const TEAM_DONE_STATES_QUERY = `
  query TeamDoneStates {
    teams(first: 50) {
      nodes {
        id
        states(first: 50) {
          nodes {
            id
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
  state: { id: string; name: string; type: string } | null;
  team: { id: string; name: string } | null;
  labels: { nodes: { id: string; name: string }[] };
};

type IssuesQueryResult = {
  issues: {
    nodes: RawIssueNode[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

type TeamDoneStatesQueryResult = {
  teams: {
    nodes: { id: string; states: { nodes: { id: string; type: string }[] } }[];
  };
};

async function fetchDoneStateIdByTeam(client: LinearClient): Promise<Map<string, string | undefined>> {
  const result = await client.client.request<TeamDoneStatesQueryResult, Record<string, never>>(TEAM_DONE_STATES_QUERY);
  const map = new Map<string, string | undefined>();
  for (const team of result.teams.nodes) {
    const doneState = team.states.nodes.find((state) => state.type === "completed");
    map.set(team.id, doneState?.id);
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

function toTask(node: RawIssueNode, doneStateIdByTeam: Map<string, string | undefined>): Task {
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
    doneStateId: node.team ? doneStateIdByTeam.get(node.team.id) : undefined,
    teamId: node.team?.id,
    teamName: node.team?.name,
    labelIds: node.labels.nodes.map((label) => label.id),
    labelNames: node.labels.nodes.map((label) => label.name),
    pinned: false,
    url: node.url,
  };
}

export async function fetchAssignedIssues(): Promise<Task[]> {
  const client = getLinearClient();
  const viewer = await client.viewer;

  const [doneStateIdByTeam, nodes] = await Promise.all([
    fetchDoneStateIdByTeam(client),
    fetchAllIssueNodes(client, viewer.id),
  ]);

  return nodes.map((node) => toTask(node, doneStateIdByTeam));
}

export async function updateIssueField(issueId: string, field: SyncOpField, value: unknown): Promise<void> {
  const client = getLinearClient();
  await client.updateIssue(issueId, { [field]: value });
}
