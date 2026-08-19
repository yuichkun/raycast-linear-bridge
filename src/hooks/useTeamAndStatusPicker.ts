import { useCachedPromise } from "@raycast/utils";
import { useState } from "react";
import { pickDefaultTeam } from "../constants";
import { resolveStartState } from "../repository/linearApi";
import { retrieveStatesForTeam, retrieveTeams } from "../storage";

// Shared by every screen that needs to pick a Linear team + starting status for an issue
// (Create Task, Promote to Linear). Previously this logic was copy-pasted into each screen
// separately, which is exactly how they drifted out of sync with each other. One
// implementation now: both default to the "General" team and its "in progress"-equivalent
// state instead of Linear's own new-issue default (often Triage).
//
// teamId/stateId are computed during render, not chased with a useEffect + setState pair.
// The earlier effect-based version had a real bug: once teamId settled, its states fetch
// re-ran asynchronously, so there was a render in between where stateId (already updated
// to the new team's default) and the dropdown's rendered items (still the previous team's
// states) came from two different points in time — Raycast logged "the value provided does
// not match any of its items" for exactly this reason. Deriving both from the same `states`
// value in the same render makes that class of mismatch impossible: the value can never be
// inconsistent with the options it's chosen from because they're computed from the same
// source in the same pass.
export function useTeamAndStatusPicker() {
  const [teamIdOverride, setTeamIdOverride] = useState<string>();
  const [stateIdOverride, setStateIdOverride] = useState<string>();

  const { isLoading: isLoadingTeams, data: teams } = useCachedPromise(retrieveTeams, [], { initialData: [] });
  const teamId = teamIdOverride ?? pickDefaultTeam(teams)?.id;

  const { isLoading: isLoadingStates, data: states } = useCachedPromise(
    (id: string | undefined) => (id ? retrieveStatesForTeam(id) : Promise.resolve([])),
    [teamId],
    { initialData: [] },
  );
  const sortedStates = [...states].sort((a, b) => a.position - b.position);

  // A manually-picked state only applies as long as it belongs to the current team's
  // states — switching teams invalidates it instead of carrying over a foreign id.
  const overrideIsValid = stateIdOverride && sortedStates.some((state) => state.id === stateIdOverride);
  const stateId = overrideIsValid ? stateIdOverride : resolveStartState(sortedStates, null)?.id;

  function setTeamId(id: string) {
    setTeamIdOverride(id);
    setStateIdOverride(undefined);
  }

  return {
    teams,
    states: sortedStates,
    teamId,
    setTeamId,
    stateId,
    setStateId: setStateIdOverride,
    isLoading: isLoadingTeams || isLoadingStates,
  };
}
