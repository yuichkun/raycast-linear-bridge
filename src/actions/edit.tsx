import { Action, ActionPanel, Icon, showToast, Toast } from "@raycast/api";
import { FC } from "react";
import { playSound } from "../sound";
import { archiveTask, markTaskComplete, markTaskInProgress } from "../storage";
import { Task } from "../types";
import { EditTask } from "./EditTask";
import { PromoteToLinear } from "./PromoteToLinear";

type Props = {
  task: Task;
  refetchList: () => void;
};

export const TaskEditMenu: FC<Props> = ({ task, refetchList }) => {
  // A local-only task has no Linear team/state, so state transitions are meaningless
  // (they'd silently no-op) — hide them and offer Promote to Linear instead.
  const isLocalOnly = task.syncState === "local";

  const handleComplete = async () => {
    try {
      await markTaskComplete(task.id);
      refetchList();
      await showToast({ style: Toast.Style.Success, title: "Marked task as complete", message: task.title });
      await playSound("todo.mp3");
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
      <Action.Push
        title="Edit Task"
        icon={Icon.Pencil}
        shortcut={{
          macOS: { modifiers: ["cmd", "shift"], key: "e" },
          Windows: { modifiers: ["ctrl", "shift"], key: "e" },
        }}
        target={<EditTask task={task} refetchList={refetchList} />}
      />
      {isLocalOnly && (
        <Action.Push
          title="Promote to Linear"
          icon={Icon.Upload}
          shortcut={{
            macOS: { modifiers: ["cmd", "shift"], key: "u" },
            Windows: { modifiers: ["ctrl", "shift"], key: "u" },
          }}
          target={<PromoteToLinear task={task} refetchList={refetchList} />}
        />
      )}
      {!isLocalOnly && (
        <Action
          title="Mark as Complete"
          icon={Icon.CheckCircle}
          shortcut={{
            macOS: { modifiers: ["cmd", "shift"], key: "c" },
            Windows: { modifiers: ["ctrl", "shift"], key: "c" },
          }}
          onAction={handleComplete}
        />
      )}
      {!isLocalOnly && (
        <Action
          title="Mark as in Progress"
          icon={Icon.Circle}
          shortcut={{
            macOS: { modifiers: ["cmd", "shift"], key: "p" },
            Windows: { modifiers: ["ctrl", "shift"], key: "p" },
          }}
          onAction={handleMarkInProgress}
        />
      )}
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
