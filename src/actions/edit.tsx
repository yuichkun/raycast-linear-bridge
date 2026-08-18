import { Action, ActionPanel, Icon, showToast, Toast } from "@raycast/api";
import { FC } from "react";
import { markTaskComplete } from "../storage";
import { Task } from "../types";

type Props = {
  task: Task;
  refetchList: () => void;
};

export const TaskEditMenu: FC<Props> = ({ task, refetchList }) => {
  const handleComplete = async () => {
    try {
      await markTaskComplete(task.id);
      refetchList();
      await showToast({ style: Toast.Style.Success, title: "Marked task as complete", message: task.title });
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to complete task",
        message: e instanceof Error ? e.message : undefined,
      });
    }
  };

  return (
    <ActionPanel.Submenu title="Edit">
      <Action
        title="Mark as Complete"
        icon={Icon.CheckCircle}
        shortcut={{
          macOS: { modifiers: ["cmd", "shift"], key: "c" },
          Windows: { modifiers: ["ctrl", "shift"], key: "c" },
        }}
        onAction={handleComplete}
      />
    </ActionPanel.Submenu>
  );
};
