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
  doneStateName?: string;
  startStateId?: string;
  startStateName?: string;
  startStateType?: WorkflowStateType;
  teamId?: string;
  teamName?: string;
  labelIds: string[];
  labelNames: string[];
  url?: string;
  // Optimistic local flag: set the instant an Archive action is taken, before the
  // archiveIssue mutation has actually reached Linear. Once Linear confirms, the next
  // pull simply omits the (now-archived) issue entirely and this flag becomes moot.
  archivedLocally: boolean;
};
