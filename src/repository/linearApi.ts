import { Issue } from "@linear/sdk";
import { getLinearClient } from "../linear/client";
import { Task, WorkflowStateType } from "../types";

async function toTask(issue: Issue): Promise<Task> {
  const [state, team, labels] = await Promise.all([issue.state, issue.team, issue.labels()]);

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
  return Promise.all(assignedIssues.nodes.map(toTask));
}
