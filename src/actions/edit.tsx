import { Action, ActionPanel, Icon, showToast, Toast } from "@raycast/api";
import { FC } from "react";
import { archiveTask, markTaskComplete, markTaskInProgress, updateDueDate } from "../storage";
import { Task } from "../types";
import { ChangeLabels } from "./ChangeLabels";
import { ChangePriority } from "./ChangePriority";
import { EditDescription } from "./EditDescription";
import { RenameTask } from "./RenameTask";

type Props = {
  task: Task;
  refetchList: () => void;
};

function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

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

  const handleMarkInProgress = async () => {
    try {
      await markTaskInProgress(task.id);
      refetchList();
      await showToast({ style: Toast.Style.Success, title: "Marked task as in progress", message: task.title });
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to mark task as in progress",
        message: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const handleUpdateDate = async (date: Date | null) => {
    try {
      await updateDueDate(task.id, date ? formatDateOnly(date) : undefined);
      refetchList();
      await showToast({ style: Toast.Style.Success, title: "Updated due date", message: task.title });
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to update due date",
        message: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const handleArchive = async () => {
    try {
      await archiveTask(task.id);
      refetchList();
      await showToast({ style: Toast.Style.Success, title: "Archived task", message: task.title });
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to archive task",
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
      <Action
        title="Mark as in Progress"
        icon={Icon.Circle}
        shortcut={{
          macOS: { modifiers: ["cmd", "shift"], key: "p" },
          Windows: { modifiers: ["ctrl", "shift"], key: "p" },
        }}
        onAction={handleMarkInProgress}
      />
      <Action.PickDate
        title="Set Date"
        type={Action.PickDate.Type.Date}
        shortcut={{
          macOS: { modifiers: ["cmd", "shift"], key: "d" },
          Windows: { modifiers: ["ctrl", "shift"], key: "d" },
        }}
        onChange={handleUpdateDate}
      />
      <Action.Push
        title="Rename Task"
        icon={Icon.Pencil}
        shortcut={{
          macOS: { modifiers: ["cmd", "shift"], key: "r" },
          Windows: { modifiers: ["ctrl", "shift"], key: "r" },
        }}
        target={<RenameTask task={task} refetchList={refetchList} />}
      />
      <Action.Push
        title="Edit Description"
        icon={Icon.Document}
        shortcut={{
          macOS: { modifiers: ["cmd", "shift"], key: "e" },
          Windows: { modifiers: ["ctrl", "shift"], key: "e" },
        }}
        target={<EditDescription task={task} refetchList={refetchList} />}
      />
      <Action.Push
        title="Change Labels"
        icon={Icon.Tag}
        shortcut={{
          macOS: { modifiers: ["cmd", "shift"], key: "t" },
          Windows: { modifiers: ["ctrl", "shift"], key: "t" },
        }}
        target={<ChangeLabels task={task} refetchList={refetchList} />}
      />
      <Action.Push
        title="Change Priority"
        icon={Icon.Stars}
        shortcut={{
          macOS: { modifiers: ["cmd", "shift"], key: "l" },
          Windows: { modifiers: ["ctrl", "shift"], key: "l" },
        }}
        target={<ChangePriority task={task} refetchList={refetchList} />}
      />
      <Action
        title="Archive Task"
        icon={Icon.Tray}
        style={Action.Style.Destructive}
        shortcut={{
          macOS: { modifiers: ["cmd", "shift"], key: "delete" },
          Windows: { modifiers: ["ctrl", "shift"], key: "delete" },
        }}
        onAction={handleArchive}
      />
    </ActionPanel.Submenu>
  );
};
