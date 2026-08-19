import { Action, ActionPanel, Form, showToast, Toast, useNavigation } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { FC, useEffect, useState } from "react";
import { resolveStartState } from "../repository/linearApi";
import { promoteToLinear, retrieveStatesForTeam, retrieveTeams } from "../storage";
import { Task, WorkflowStateType } from "../types";

type Props = {
  task: Task;
  refetchList: () => void;
};

export const PromoteToLinear: FC<Props> = ({ task, refetchList }) => {
  const { pop } = useNavigation();
  const [teamId, setTeamId] = useState<string>();
  const [stateId, setStateId] = useState<string>();

  const { isLoading: isLoadingTeams, data: teams } = useCachedPromise(retrieveTeams, [], { initialData: [] });
  const { isLoading: isLoadingStates, data: states } = useCachedPromise(
    (id: string | undefined) => (id ? retrieveStatesForTeam(id) : Promise.resolve([])),
    [teamId],
    { initialData: [] },
  );

  // Same reasoning as Create Task: default to the "in progress"-equivalent state instead
  // of whatever Linear would otherwise default a new issue to (often Triage).
  useEffect(() => {
    setStateId(undefined);
  }, [teamId]);
  useEffect(() => {
    if (!stateId && states.length > 0) {
      const defaultState = resolveStartState(states, null);
      if (defaultState) setStateId(defaultState.id);
    }
  }, [states, stateId]);

  const sortedStates = [...states].sort((a, b) => a.position - b.position);

  const handleSubmit = async ({
    teamId: selectedTeamId,
    stateId: selectedStateId,
  }: {
    teamId: string;
    stateId: string;
  }) => {
    const team = teams.find((t) => t.id === selectedTeamId);
    const state = states.find((s) => s.id === selectedStateId);
    if (!team || !state) {
      await showToast({ style: Toast.Style.Failure, title: "Select a team and status" });
      return;
    }

    try {
      await promoteToLinear(task.id, team.id, team.name, state.id, state.name, state.type as WorkflowStateType);
      refetchList();
      pop();
      await showToast({ style: Toast.Style.Success, title: "Promoted to Linear", message: task.title });
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to promote task",
        message: e instanceof Error ? e.message : undefined,
      });
    }
  };

  return (
    <Form
      isLoading={isLoadingTeams || isLoadingStates}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Promote to Linear" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="teamId" title="Team" onChange={setTeamId}>
        {teams.map((team) => (
          <Form.Dropdown.Item key={team.id} value={team.id} title={team.name} />
        ))}
      </Form.Dropdown>
      <Form.Dropdown id="stateId" title="Status" value={stateId} onChange={setStateId}>
        {sortedStates.map((state) => (
          <Form.Dropdown.Item key={state.id} value={state.id} title={state.name} />
        ))}
      </Form.Dropdown>
    </Form>
  );
};
