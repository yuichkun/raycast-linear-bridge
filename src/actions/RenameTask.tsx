import { Action, ActionPanel, Form, showToast, Toast, useNavigation } from "@raycast/api";
import { FC } from "react";
import { renameTask } from "../storage";
import { Task } from "../types";

type Props = {
  task: Task;
  refetchList: () => void;
};

export const RenameTask: FC<Props> = ({ task, refetchList }) => {
  const { pop } = useNavigation();

  const handleSubmit = async ({ newTitle }: { newTitle: string }) => {
    try {
      await renameTask(task.id, newTitle);
      refetchList();
      pop();
      await showToast({ style: Toast.Style.Success, title: "Renamed task", message: newTitle });
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to rename task",
        message: e instanceof Error ? e.message : undefined,
      });
    }
  };

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Rename Task" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField defaultValue={task.title} id="newTitle" title="Task Name" />
    </Form>
  );
};
