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
  // stateId is a real Linear id for synced/pendingCreate tasks. Local-only tasks have a
  // real stage too (stateName/stateType) — see localStages.ts — but no id, since there's
  // no Linear state to point at. The done/start state to move a task to is resolved
  // on-demand from the task's team (or from LOCAL_STAGES for local tasks) rather than
  // precomputed and stored here — see storage.ts's resolveMoveTarget.
  stateId?: string;
  stateName?: string;
  stateType?: WorkflowStateType;
  statePosition?: number;
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

// Shared between repository/linearApi.ts and repository/syncQueue.ts — defined here
// (rather than in linearApi.ts) so syncQueue.ts can reference it without creating a
// dependency cycle (linearApi.ts already imports SyncOpField from syncQueue.ts).
export type CreateIssueInput = {
  teamId: string;
  title: string;
  description?: string;
  dueDate?: string;
  priority?: number;
  stateId?: string;
  labelIds?: string[];
};
