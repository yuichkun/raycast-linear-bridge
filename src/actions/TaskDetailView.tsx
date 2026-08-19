import { ActionPanel, Detail } from "@raycast/api";
import { FC } from "react";
import { PRIORITY_NAMES } from "../constants";
import { Task } from "../types";
import { TaskEditMenu } from "./edit";

type Props = {
  task: Task;
  refetchList: () => void;
};

export const TaskDetailView: FC<Props> = ({ task, refetchList }) => {
  const isLocalOnly = task.syncState === "local";

  return (
    <Detail
      navigationTitle={task.title}
      markdown={task.description || "*No description*"}
      actions={
        <ActionPanel title="Linear Bridge">
          <TaskEditMenu task={task} refetchList={refetchList} />
        </ActionPanel>
      }
      metadata={
        <Detail.Metadata>
          {isLocalOnly && <Detail.Metadata.Label title="Sync" text="Local only — not saved to Linear" />}
          <Detail.Metadata.Label title="Team" text={task.teamName ?? "—"} />
          <Detail.Metadata.Label title="Status" text={task.stateName ?? "—"} />
          <Detail.Metadata.Label
            title="Due Date"
            text={task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "—"}
          />
          <Detail.Metadata.Label title="Priority" text={PRIORITY_NAMES[task.priority] ?? "No priority"} />
          <Detail.Metadata.Separator />
          <Detail.Metadata.TagList title="Labels">
            {task.labelNames.length > 0 ? (
              task.labelNames.map((name) => <Detail.Metadata.TagList.Item key={name} text={name} />)
            ) : (
              <Detail.Metadata.TagList.Item text="No labels" />
            )}
          </Detail.Metadata.TagList>
        </Detail.Metadata>
      }
    />
  );
};
