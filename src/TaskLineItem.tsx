import { ActionPanel, List } from "@raycast/api";
import { FC } from "react";
import { TaskEditMenu } from "./actions/edit";
import { Task } from "./types";

type Props = {
  task: Task;
  refetchList: () => void;
};

export const TaskLineItem: FC<Props> = ({ task, refetchList }) => {
  return (
    <List.Item
      id={task.id}
      title={task.title}
      accessories={[
        { tag: task.stateName ? { value: task.stateName } : null },
        { text: task.dueDate ? new Date(task.dueDate).toLocaleDateString() : null },
      ]}
      actions={
        <ActionPanel title="Linear Bridge">
          <TaskEditMenu task={task} refetchList={refetchList} />
        </ActionPanel>
      }
    />
  );
};
