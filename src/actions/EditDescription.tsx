import { Action, ActionPanel, Form, showToast, Toast, useNavigation } from "@raycast/api";
import { FC } from "react";
import { updateDescription } from "../storage";
import { Task } from "../types";

type Props = {
  task: Task;
  refetchList: () => void;
};

export const EditDescription: FC<Props> = ({ task, refetchList }) => {
  const { pop } = useNavigation();

  const handleSubmit = async ({ description }: { description: string }) => {
    try {
      await updateDescription(task.id, description || undefined);
      refetchList();
      pop();
      await showToast({ style: Toast.Style.Success, title: "Updated description", message: task.title });
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to update description",
        message: e instanceof Error ? e.message : undefined,
      });
    }
  };

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Description" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextArea defaultValue={task.description ?? ""} id="description" title="Description" />
    </Form>
  );
};
