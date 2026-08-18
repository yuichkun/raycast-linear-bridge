import { Action, ActionPanel, Form, showToast, Toast, useNavigation } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { FC } from "react";
import { promoteToLinear, retrieveTeams } from "../storage";
import { Task } from "../types";

type Props = {
  task: Task;
  refetchList: () => void;
};

export const PromoteToLinear: FC<Props> = ({ task, refetchList }) => {
  const { pop } = useNavigation();
  const { isLoading, data: teams } = useCachedPromise(retrieveTeams, [], { initialData: [] });

  const handleSubmit = async ({ teamId }: { teamId: string }) => {
    const team = teams.find((t) => t.id === teamId);
    if (!team) {
      await showToast({ style: Toast.Style.Failure, title: "Select a team" });
      return;
    }

    try {
      await promoteToLinear(task.id, team.id, team.name);
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
      <Form.Dropdown id="teamId" title="Team">
        {teams.map((team) => (
          <Form.Dropdown.Item key={team.id} value={team.id} title={team.name} />
        ))}
      </Form.Dropdown>
    </Form>
  );
};
