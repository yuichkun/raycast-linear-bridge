import { Alert, confirmAlert, showToast, Toast } from "@raycast/api";
import { archiveCompletedTasks, retrieveCachedItems } from "./storage";

export default async function Command() {
  const tasks = await retrieveCachedItems();
  const completedCount = tasks.filter((task) => task.stateType === "completed" && !task.archivedLocally).length;

  if (completedCount === 0) {
    await showToast({
      style: Toast.Style.Success,
      title: "Nothing to Archive",
      message: "There are no completed tasks.",
    });
    return;
  }

  const confirmed = await confirmAlert({
    title: "Archive Completed Tasks",
    message: `Archive ${completedCount} completed ${completedCount === 1 ? "task" : "tasks"}?`,
    primaryAction: {
      title: "Archive",
      style: Alert.ActionStyle.Destructive,
    },
    dismissAction: {
      title: "Cancel",
    },
  });

  if (!confirmed) {
    await showToast({
      style: Toast.Style.Success,
      title: "Cancelled",
      message: "Completed tasks were not archived.",
    });
    return;
  }

  const toast = await showToast({
    style: Toast.Style.Animated,
    title: "Archiving Completed Tasks",
    message: `${completedCount} ${completedCount === 1 ? "task" : "tasks"}`,
  });

  try {
    const archivedCount = await archiveCompletedTasks();
    toast.style = Toast.Style.Success;
    toast.title = "Archived Completed Tasks";
    toast.message = `${archivedCount} ${archivedCount === 1 ? "task" : "tasks"} archived`;
  } catch (error) {
    toast.style = Toast.Style.Failure;
    toast.title = "Failed to Archive";
    if (error instanceof Error) {
      toast.message = error.message;
    }
  }
}
