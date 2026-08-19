import { ActionPanel, Detail } from "@raycast/api";
import { FC } from "react";
import { taskDetailMarkdown, TaskMetadata } from "../TaskMetadata";
import { Task } from "../types";
import { TaskEditMenu } from "./edit";

type Props = {
  task: Task;
  refetchList: () => void;
};

export const TaskDetailView: FC<Props> = ({ task, refetchList }) => {
  return (
    <Detail
      navigationTitle={task.title}
      markdown={taskDetailMarkdown(task)}
      actions={
        <ActionPanel title="Linear Bridge">
          <TaskEditMenu task={task} refetchList={refetchList} />
        </ActionPanel>
      }
      metadata={<TaskMetadata task={task} />}
    />
  );
};
