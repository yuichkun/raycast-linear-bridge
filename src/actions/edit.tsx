import { Action, Alert, confirmAlert, Icon, showToast, Toast } from "@raycast/api";
import { FC, Fragment } from "react";
import { playSound } from "../sound";
import { archiveTask, markTaskComplete, markTaskInProgress, markTaskTodo } from "../storage";
import { Task } from "../types";
import { EditTask } from "./EditTask";
import { PromoteToLinear } from "./PromoteToLinear";

type Props = {
  task: Task;
  refetchList: () => void;
};

export const TaskEditMenu: FC<Props> = ({ task, refetchList }) => {
  // Local-only tasks have a real stage (LOCAL_STAGES) just like any other task — the only
  // thing "local" changes is whether it exists in Linear, not what actions apply to it.
  // Promote to Linear is the one exception, since it's specifically about that difference.
  const isLocalOnly = task.syncState === "local";
  const isDone = task.stateType === "completed";
  const isInProgress = task.stateType === "started";

  // A toggle, not a one-way action: pressing Complete again on an already-Done task means
  // "I need to reopen this," and In Progress is a more useful landing spot than Backlog —
  // you're the one reopening it, so you're presumably about to work on it.
  const handleComplete = async () => {
    try {
      if (isDone) {
        await markTaskInProgress(task.id);
        refetchList();
        await showToast({ style: Toast.Style.Success, title: "Marked task as in progress", message: task.title });
      } else {
        await markTaskComplete(task.id);
        refetchList();
        await showToast({ style: Toast.Style.Success, title: "Marked task as complete", message: task.title });
        await playSound("todo.mp3");
      }
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: isDone ? "Failed to mark task as in progress" : "Failed to complete task",
        message: e instanceof Error ? e.message : undefined,
      });
    }
  };

  // Same toggle shape as Mark as Complete: pressing this again on an already-in-progress
  // task means "not working on this right now," and Todo is the natural landing spot.
  const handleMarkInProgress = async () => {
    try {
      if (isInProgress) {
        await markTaskTodo(task.id);
        refetchList();
        await showToast({ style: Toast.Style.Success, title: "Marked task as todo", message: task.title });
      } else {
        await markTaskInProgress(task.id);
        refetchList();
        await showToast({ style: Toast.Style.Success, title: "Marked task as in progress", message: task.title });
      }
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: isInProgress ? "Failed to mark task as todo" : "Failed to mark task as in progress",
        message: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const handleArchive = async () => {
    const confirmed = await confirmAlert({
      title: "Archive Task",
      message: `Archive "${task.title}"?`,
      primaryAction: { title: "Archive", style: Alert.ActionStyle.Destructive },
      dismissAction: { title: "Cancel" },
    });
    if (!confirmed) return;

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

  // Flat actions rather than nested in an ActionPanel.Submenu: shortcuts on submenu-nested
  // actions weren't firing reliably, and burying high-frequency actions (Complete, Archive)
  // one level deep also made them harder to find via the actions list.
  return (
    <Fragment>
      <Action.Push
        title="Edit Task"
        icon={Icon.Pencil}
        shortcut={{
          macOS: { modifiers: ["cmd", "shift"], key: "e" },
          Windows: { modifiers: ["ctrl", "shift"], key: "e" },
        }}
        target={<EditTask task={task} refetchList={refetchList} />}
      />
      {task.url && (
        <Action.OpenInBrowser
          url={task.url}
          shortcut={{
            macOS: { modifiers: ["cmd", "shift"], key: "o" },
            Windows: { modifiers: ["ctrl", "shift"], key: "o" },
          }}
        />
      )}
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
      <Action
        title={isDone ? "Mark as in Progress" : "Mark as Complete"}
        icon={isDone ? Icon.Circle : Icon.CheckCircle}
        shortcut={{
          macOS: { modifiers: ["cmd", "shift"], key: "c" },
          Windows: { modifiers: ["ctrl", "shift"], key: "c" },
        }}
        onAction={handleComplete}
      />
      <Action
        title={isInProgress ? "Mark as Todo" : "Mark as in Progress"}
        icon={isInProgress ? Icon.Circle : Icon.CircleProgress50}
        shortcut={{
          macOS: { modifiers: ["cmd", "shift"], key: "p" },
          Windows: { modifiers: ["ctrl", "shift"], key: "p" },
        }}
        onAction={handleMarkInProgress}
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
    </Fragment>
  );
};
