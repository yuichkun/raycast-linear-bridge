import { Action, ActionPanel, Form, showToast, Toast, useNavigation } from "@raycast/api";
import { FC } from "react";
import { PRIORITY_NAMES } from "../constants";
import { updatePriority } from "../storage";
import { Task } from "../types";

type Props = {
  task: Task;
  refetchList: () => void;
};

export const ChangePriority: FC<Props> = ({ task, refetchList }) => {
  const { pop } = useNavigation();

  const handleSubmit = async ({ priority }: { priority: string }) => {
    try {
      await updatePriority(task.id, Number(priority));
      refetchList();
      pop();
      await showToast({ style: Toast.Style.Success, title: "Updated priority", message: task.title });
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to update priority",
        message: e instanceof Error ? e.message : undefined,
      });
    }
  };

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Change Priority" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="priority" title="Priority" defaultValue={String(task.priority)}>
        {Object.entries(PRIORITY_NAMES).map(([value, name]) => (
          <Form.Dropdown.Item key={value} value={value} title={name} />
        ))}
      </Form.Dropdown>
    </Form>
  );
};
