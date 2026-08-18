import { Issue, LinearClient } from "@linear/sdk";
import { getLinearClient } from "../linear/client";
import { Task, WorkflowStateType } from "../types";
import { SyncOpField } from "./syncQueue";

const doneStateIdCache = new Map<string, string | undefined>();

async function resolveDoneStateId(client: LinearClient, teamId: string): Promise<string | undefined> {
  if (doneStateIdCache.has(teamId)) return doneStateIdCache.get(teamId);

  const team = await client.team(teamId);
  const states = await team.states();
  const doneState = states.nodes.find((state) => state.type === "completed");

  doneStateIdCache.set(teamId, doneState?.id);
  return doneState?.id;
}

async function toTask(client: LinearClient, issue: Issue): Promise<Task> {
  const [state, team, labels] = await Promise.all([issue.state, issue.team, issue.labels()]);
  const doneStateId = team ? await resolveDoneStateId(client, team.id) : undefined;

  return {
    id: issue.id,
    syncState: "synced",
    title: issue.title,
    description: issue.description ?? undefined,
    dueDate: issue.dueDate ?? undefined,
    priority: issue.priority ?? 0,
    stateId: state?.id,
    stateName: state?.name,
    stateType: state?.type as WorkflowStateType | undefined,
    doneStateId,
    teamId: team?.id,
    teamName: team?.name,
    labelIds: labels.nodes.map((label) => label.id),
    labelNames: labels.nodes.map((label) => label.name),
    pinned: false,
    url: issue.url,
  };
}

export async function fetchAssignedIssues(): Promise<Task[]> {
  const client = getLinearClient();
  const viewer = await client.viewer;
  const assignedIssues = await viewer.assignedIssues();
  return Promise.all(assignedIssues.nodes.map((issue) => toTask(client, issue)));
}

export async function updateIssueField(issueId: string, field: SyncOpField, value: unknown): Promise<void> {
  const client = getLinearClient();
  await client.updateIssue(issueId, { [field]: value });
}
