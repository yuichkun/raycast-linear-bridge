import { Action, ActionPanel, Form, showToast, Toast, useNavigation } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { FC } from "react";
import { changeTaskState, retrieveStatesForTeam } from "../storage";
import { Task, WorkflowStateType } from "../types";

type Props = {
  task: Task;
  refetchList: () => void;
};

export const ChangeStatus: FC<Props> = ({ task, refetchList }) => {
  const { pop } = useNavigation();
  const { isLoading, data: states } = useCachedPromise(
    (teamId: string | undefined) => (teamId ? retrieveStatesForTeam(teamId) : Promise.resolve([])),
    [task.teamId],
    { initialData: [] },
  );

  const handleSubmit = async ({ stateId }: { stateId: string }) => {
    const state = states.find((s) => s.id === stateId);
    if (!state) {
      await showToast({ style: Toast.Style.Failure, title: "Select a status" });
      return;
    }

    try {
      await changeTaskState(task.id, state.id, state.name, state.type as WorkflowStateType);
      refetchList();
      pop();
      await showToast({ style: Toast.Style.Success, title: "Updated status", message: state.name });
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to update status",
        message: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const sortedStates = [...states].sort((a, b) => a.position - b.position);

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Change Status" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="stateId" title="Status" defaultValue={task.stateId}>
        {sortedStates.map((state) => (
          <Form.Dropdown.Item key={state.id} value={state.id} title={state.name} />
        ))}
      </Form.Dropdown>
    </Form>
  );
};
