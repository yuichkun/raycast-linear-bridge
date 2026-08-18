export interface Preferences {
  linearApiKey: string;
}

export type SyncState = "local" | "pendingCreate" | "synced";

export type WorkflowStateType = "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled" | "duplicate";

export type Task = {
  id: string;
  syncState: SyncState;
  title: string;
  description?: string;
  dueDate?: string;
  priority: number;
  stateId?: string;
  stateName?: string;
  stateType?: WorkflowStateType;
  statePosition?: number;
  doneStateId?: string;
  startStateId?: string;
  teamId?: string;
  teamName?: string;
  labelIds: string[];
  labelNames: string[];
  url?: string;
};
