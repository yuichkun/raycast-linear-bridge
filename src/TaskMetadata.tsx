import { Detail } from "@raycast/api";
import { FC } from "react";
import { PRIORITY_NAMES } from "./constants";
import { Task } from "./types";

// `Detail.Metadata` and `List.Item.Detail.Metadata` are the same underlying component in
// the Raycast API (both are `typeof Metadata`), so this single implementation renders
// correctly as the metadata prop of either `<Detail>` (full-screen view) or
// `<List.Item.Detail>` (inline panel) without needing two copies.
export function taskDetailMarkdown(task: Task): string {
  return task.description || "*No description*";
}

type Props = {
  task: Task;
};

export const TaskMetadata: FC<Props> = ({ task }) => {
  const isLocalOnly = task.syncState === "local";

  return (
    <Detail.Metadata>
      {isLocalOnly && <Detail.Metadata.Label title="Sync" text="Local only — not saved to Linear" />}
      <Detail.Metadata.Label title="Team" text={task.teamName ?? "—"} />
      <Detail.Metadata.Label title="Status" text={task.stateName ?? "—"} />
      <Detail.Metadata.Label title="Due Date" text={task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "—"} />
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
  );
};
