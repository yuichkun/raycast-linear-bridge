import { Action, ActionPanel, Form, showToast, Toast, useNavigation } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { FC } from "react";
import { retrieveLabelsForTeam, updateLabels } from "../storage";
import { Task } from "../types";

type Props = {
  task: Task;
  refetchList: () => void;
};

export const ChangeLabels: FC<Props> = ({ task, refetchList }) => {
  const { pop } = useNavigation();
  const { isLoading, data: labels } = useCachedPromise(
    (teamId: string | undefined) => (teamId ? retrieveLabelsForTeam(teamId) : Promise.resolve([])),
    [task.teamId],
    { initialData: [] },
  );

  const handleSubmit = async ({ labelIds }: { labelIds: string[] }) => {
    try {
      await updateLabels(task.id, labelIds);
      refetchList();
      pop();
      await showToast({ style: Toast.Style.Success, title: "Updated labels", message: task.title });
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to update labels",
        message: e instanceof Error ? e.message : undefined,
      });
    }
  };

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Change Labels" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TagPicker id="labelIds" title="Labels" defaultValue={task.labelIds}>
        {labels.map((label) => (
          <Form.TagPicker.Item key={label.id} value={label.id} title={label.name} />
        ))}
      </Form.TagPicker>
    </Form>
  );
};
