import { Action, ActionPanel, Form, showToast, Toast, useNavigation } from "@raycast/api";
import { FC } from "react";
import { useTeamAndStatusPicker } from "../hooks/useTeamAndStatusPicker";
import { promoteToLinear } from "../storage";
import { Task } from "../types";

type Props = {
  task: Task;
  refetchList: () => void;
};

export const PromoteToLinear: FC<Props> = ({ task, refetchList }) => {
  const { pop } = useNavigation();
  // Defaults the status to the target team's equivalent of whatever stage this task is
  // currently in (LOCAL_STAGES, since a local-only task always has one now) — promoting
  // should preserve where the task already was, not reset it back to "todo".
  const { teams, states, teamId, setTeamId, stateId, setStateId, isLoading } = useTeamAndStatusPicker(
    task.stateType ?? "unstarted",
  );

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
      await promoteToLinear(task.id, team, state.id);
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
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Promote to Linear" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="teamId" title="Team" value={teamId} onChange={setTeamId}>
        {teams.map((team) => (
          <Form.Dropdown.Item key={team.id} value={team.id} title={team.name} />
        ))}
      </Form.Dropdown>
      <Form.Dropdown id="stateId" title="Status" value={stateId} onChange={setStateId}>
        {states.map((state) => (
          <Form.Dropdown.Item key={state.id} value={state.id} title={state.name} />
        ))}
      </Form.Dropdown>
    </Form>
  );
};
