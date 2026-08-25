import { ActionPanel, Detail, useNavigation } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { FC, useEffect } from "react";
import { commentsMarkdown } from "../commentsMarkdown";
import { fetchCommentsForTask, retrieveCachedItems } from "../storage";
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

  const isSynced = task?.syncState === "synced";
  // Comments live only in Linear, so they're fetched on open rather than served from the
  // tasks cache (a local-only or not-yet-created task has none to fetch). useCachedPromise
  // keeps the last successful result: reopening shows comments instantly while
  // revalidating, and an offline open still shows what was seen last time.
  const {
    data: comments,
    isLoading: isLoadingComments,
    error: commentsError,
    revalidate: revalidateComments,
  } = useCachedPromise(
    async (id: string, synced: boolean) => (synced ? fetchCommentsForTask(id) : []),
    [taskId, isSynced],
  );

  const handleRefetch = () => {
    refetchList();
    revalidate();
    revalidateComments();
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

  let commentsSection = "";
  if (isSynced) {
    if (comments) {
      commentsSection = commentsMarkdown(comments);
      if (commentsError) commentsSection += "\n\n_Showing the last loaded comments — Linear is unreachable._";
    } else if (commentsError) {
      commentsSection = "## Comments\n\n_Couldn't load comments — Linear is unreachable._";
    } else {
      commentsSection = "## Comments\n\n_Loading comments…_";
    }
  }
  const markdown = commentsSection
    ? `${taskDetailMarkdown(task)}\n\n---\n\n${commentsSection}`
    : taskDetailMarkdown(task);

  return (
    <Detail
      isLoading={isLoadingComments}
      navigationTitle={task.title}
      markdown={markdown}
      actions={
        <ActionPanel title="Linear Bridge">
          <TaskEditMenu task={task} refetchList={handleRefetch} />
        </ActionPanel>
      }
      metadata={<TaskMetadata task={task} />}
    />
  );
};
