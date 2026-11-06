import { Action, ActionPanel, Alert, confirmAlert, Icon, showToast, Toast } from "@raycast/api";
import type { Keyboard } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { FC, Fragment } from "react";
import { formatDateOnly } from "../date";
import { useLinearApp } from "../hooks/useLinearApp";
import { toLinearDeepLink } from "../linearApp";
import { LOCAL_STAGES } from "../localStages";
import { playSound } from "../sound";
import {
  archiveTask,
  changeTaskState,
  markTaskComplete,
  markTaskInProgress,
  markTaskTodo,
  retrieveStatesForTeam,
  StateChoice,
  updateDueDate,
} from "../storage";
import { Task } from "../types";
import { AddComment } from "./AddComment";
import { EditTask } from "./EditTask";
import { PromoteToLinear } from "./PromoteToLinear";

type Props = {
  task: Task;
  refetchList: () => void;
};

// One shortcut for both ways of opening the issue: the desktop app when it's installed,
// the browser otherwise. The app gets the linear:// form of the URL (see toLinearDeepLink);
// the browser gets the https one.
const OPEN_ISSUE_SHORTCUT: Keyboard.Shortcut = {
  macOS: { modifiers: ["cmd", "shift"], key: "o" },
  Windows: { modifiers: ["ctrl", "shift"], key: "o" },
};

export const TaskEditMenu: FC<Props> = ({ task, refetchList }) => {
  // Local-only tasks have a real stage (LOCAL_STAGES) just like any other task — the only
  // thing "local" changes is whether it exists in Linear, not what actions apply to it.
  // Promote to Linear is the one exception, since it's specifically about that difference.
  const isLocalOnly = task.syncState === "local";
  // Comments need a real Linear issue to attach to — not a local-only task, and not one
  // still waiting to be created (its id is a tempId until then).
  const isSynced = task.syncState === "synced";
  const isDone = task.stateType === "completed";
  const isInProgress = task.stateType === "started";
  const hasTeam = Boolean(task.teamId);
  const linearApp = useLinearApp();

  // Reads from the local cache (retrieveStatesForTeam), so opening this submenu is cheap
  // even though it's mounted per row — it's not a network call. Local-only tasks skip the
  // fetch entirely and use the fixed LOCAL_STAGES list instead.
  const { data: teamStates, isLoading: isLoadingStates } = useCachedPromise(
    (teamId: string | undefined) => (teamId ? retrieveStatesForTeam(teamId) : Promise.resolve([])),
    [task.teamId],
    { initialData: [] },
  );
  const statusOptions: { key: string; name: string; choice: StateChoice }[] = hasTeam
    ? [...teamStates]
        .sort((a, b) => a.position - b.position)
        .map((state) => ({ key: state.id, name: state.name, choice: { stateId: state.id } }))
    : LOCAL_STAGES.map((stage) => ({ key: stage.type, name: stage.name, choice: { localStageType: stage.type } }));

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

  const handleUpdateDueDate = async (date: Date | null) => {
    try {
      const newDueDate = date ? formatDateOnly(date) : undefined;
      await updateDueDate(task.id, newDueDate);
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

  const handleChangeStatus = async (choice: StateChoice, stateName: string) => {
    try {
      await changeTaskState(task.id, choice);
      refetchList();
      await showToast({ style: Toast.Style.Success, title: "Updated status", message: `${task.title} → ${stateName}` });
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to update status",
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

  // Flat actions rather than nested in one big Edit submenu: shortcuts assigned to items
  // nested *inside* a submenu weren't firing reliably, and burying high-frequency actions
  // (Complete, Archive) one level deep also made them harder to find via the actions list.
  // Change Status is a narrower exception: the submenu itself carries the shortcut (opens
  // instantly, no items inside have their own shortcut), which is a different code path
  // from the one that broke.
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
      <Action.PickDate
        title="Set Due Date"
        type={Action.PickDate.Type.Date}
        shortcut={{
          macOS: { modifiers: ["cmd", "shift"], key: "d" },
          Windows: { modifiers: ["ctrl", "shift"], key: "d" },
        }}
        onChange={handleUpdateDueDate}
      />
      <ActionPanel.Submenu
        title="Change Status"
        icon={Icon.Switch}
        isLoading={hasTeam && isLoadingStates}
        // Deliberately not Keyboard.Shortcut.Common.Duplicate: only its Windows binding
        // (ctrl+shift+S) matches ours, and adopting the Common would move macOS to ⌘D,
        // which Show/Hide Details already owns. "Duplicate" is the wrong verb here anyway.
        // eslint-disable-next-line @raycast/prefer-common-shortcut
        shortcut={{
          macOS: { modifiers: ["cmd", "shift"], key: "s" },
          Windows: { modifiers: ["ctrl", "shift"], key: "s" },
        }}
      >
        {statusOptions.map((option) => (
          <Action
            key={option.key}
            title={option.name}
            onAction={() => handleChangeStatus(option.choice, option.name)}
          />
        ))}
      </ActionPanel.Submenu>
      {isSynced && (
        <Action.Push
          title="Add Comment"
          icon={Icon.SpeechBubble}
          shortcut={{
            macOS: { modifiers: ["cmd", "shift"], key: "m" },
            Windows: { modifiers: ["ctrl", "shift"], key: "m" },
          }}
          target={<AddComment task={task} refetchList={refetchList} />}
        />
      )}
      {task.url &&
        (linearApp ? (
          <Action.Open
            title="Open in Linear"
            icon={{ fileIcon: linearApp.path }}
            target={toLinearDeepLink(task.url)}
            application={linearApp}
            shortcut={OPEN_ISSUE_SHORTCUT}
          />
        ) : (
          <Action.OpenInBrowser url={task.url} shortcut={OPEN_ISSUE_SHORTCUT} />
        ))}
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
        // Deliberately not Keyboard.Shortcut.Common.Copy: the bindings are identical on
        // both platforms, but this action completes a task rather than copying anything.
        // eslint-disable-next-line @raycast/prefer-common-shortcut
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
