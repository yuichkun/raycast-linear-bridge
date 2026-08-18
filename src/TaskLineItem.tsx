import { List } from "@raycast/api";
import { FC } from "react";
import { Task } from "./types";

type Props = {
  task: Task;
};

export const TaskLineItem: FC<Props> = ({ task }) => {
  return (
    <List.Item
      id={task.id}
      title={task.title}
      accessories={[
        { tag: task.stateName ? { value: task.stateName } : null },
        { text: task.dueDate ? new Date(task.dueDate).toLocaleDateString() : null },
      ]}
    />
  );
};
