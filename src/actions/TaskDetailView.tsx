import { ActionPanel, Detail, useNavigation } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { FC, useEffect } from "react";
import { retrieveCachedItems } from "../storage";
import { taskDetailMarkdown, TaskMetadata } from "../TaskMetadata";
import { TaskEditMenu } from "./edit";

type Props = {
  taskId: string;
  refetchList: () => void;
};

// Takes a taskId rather than a Task snapshot: this view stays open across nested edits
// (Edit Task, Mark as Complete, ...) pushed on top of it, and a snapshot prop would freeze
// on whatever the task looked like when this screen was first opened. Re-reading from the
// cache after every edit keeps what's on screen current.
export const TaskDetailView: FC<Props> = ({ taskId, refetchList }) => {
  const { pop } = useNavigation();
  const {
    isLoading,
    data: task,
    revalidate,
  } = useCachedPromise(
    async (id: string) => {
      const tasks = await retrieveCachedItems();
      return tasks.find((t) => t.id === id) ?? null;
    },
    [taskId],
  );

  const handleRefetch = () => {
    refetchList();
    revalidate();
  };

  // The task can disappear from the cache entirely (e.g. Archive Task on a local-only
  // task deletes it outright) — pop back to the list instead of showing a dead screen.
  useEffect(() => {
    if (!isLoading && task === null) {
      pop();
    }
  }, [isLoading, task, pop]);

  if (!task) {
    return <Detail isLoading navigationTitle="Loading…" markdown="" />;
  }

  return (
    <Detail
      navigationTitle={task.title}
      markdown={taskDetailMarkdown(task)}
      actions={
        <ActionPanel title="Linear Bridge">
          <TaskEditMenu task={task} refetchList={handleRefetch} />
        </ActionPanel>
      }
      metadata={<TaskMetadata task={task} />}
    />
  );
};
