import { WorkflowStateType } from "./types";

export type LocalStage = { name: string; type: WorkflowStateType };

// Local-only tasks aren't tied to a Linear team, so they can't use real Linear state ids —
// but they should carry a real stage just like any other task, not a special "New"
// placeholder. The only thing that makes a task "local" is whether it exists in Linear,
// not whether it has a meaningful stage. Covers the everyday stages only (no Triage/
// Canceled/Duplicate — those are Linear workflow concepts a personal quick-note task
// doesn't need).
export const LOCAL_STAGES: LocalStage[] = [
  { name: "Backlog", type: "backlog" },
  { name: "Todo", type: "unstarted" },
  { name: "In Progress", type: "started" },
  { name: "Done", type: "completed" },
];

export const DEFAULT_LOCAL_STAGE: LocalStage = LOCAL_STAGES.find((stage) => stage.type === "started")!;

export function findLocalStage(type: WorkflowStateType | undefined): LocalStage | undefined {
  return LOCAL_STAGES.find((stage) => stage.type === type);
}
