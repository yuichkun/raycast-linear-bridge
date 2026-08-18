import { ActionPanel, List } from "@raycast/api";
import { FC } from "react";
import { TaskEditMenu } from "./actions/edit";
import { classifyTask } from "./task-order";
import { Task } from "./types";

type Props = {
  task: Task;
  refetchList: () => void;
};

export const TaskLineItem: FC<Props> = ({ task, refetchList }) => {
  // Every other section's title already names the state (dynamic per-state sections,
  // or the fixed "Done"), so a repeated tag would be redundant. Outdated is the
  // exception: it groups tasks by due date regardless of state, so the tag is the only
  // place left to see what state an overdue task is actually in.
  const showStateTag = classifyTask(task) === "outdated";

  return (
    <List.Item
      id={task.id}
      title={task.title}
      accessories={[
        { tag: showStateTag && task.stateName ? { value: task.stateName } : null },
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
