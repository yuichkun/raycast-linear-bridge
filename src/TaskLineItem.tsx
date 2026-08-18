import { ActionPanel, Color, Icon, List } from "@raycast/api";
import { FC } from "react";
import { TaskEditMenu } from "./actions/edit";
import { PRIORITY_COLORS, PRIORITY_ICONS, PRIORITY_NAMES } from "./constants";
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
  const priorityIcon = PRIORITY_ICONS[task.priority];
  const isLocalOnly = task.syncState === "local";

  return (
    <List.Item
      id={task.id}
      icon={isLocalOnly ? { source: Icon.HardDrive, tintColor: Color.SecondaryText } : undefined}
      title={task.title}
      accessories={[
        { icon: priorityIcon ? { source: priorityIcon, tintColor: PRIORITY_COLORS[task.priority] } : null },
        ...task.labelNames.map((name) => ({ tag: { value: name } })),
        { tag: showStateTag && task.stateName ? { value: task.stateName } : null },
        { text: task.dueDate ? new Date(task.dueDate).toLocaleDateString() : null },
      ]}
      detail={
        <List.Item.Detail
          markdown={task.description || "*No description*"}
          metadata={
            <List.Item.Detail.Metadata>
              {isLocalOnly && <List.Item.Detail.Metadata.Label title="Sync" text="Local only — not saved to Linear" />}
              <List.Item.Detail.Metadata.Label title="Team" text={task.teamName ?? "—"} />
              <List.Item.Detail.Metadata.Label title="Status" text={task.stateName ?? "—"} />
              <List.Item.Detail.Metadata.Label
                title="Due Date"
                text={task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "—"}
              />
              <List.Item.Detail.Metadata.Label title="Priority" text={PRIORITY_NAMES[task.priority] ?? "No priority"} />
              <List.Item.Detail.Metadata.Separator />
              <List.Item.Detail.Metadata.TagList title="Labels">
                {task.labelNames.length > 0 ? (
                  task.labelNames.map((name) => <List.Item.Detail.Metadata.TagList.Item key={name} text={name} />)
                ) : (
                  <List.Item.Detail.Metadata.TagList.Item text="No labels" />
                )}
              </List.Item.Detail.Metadata.TagList>
            </List.Item.Detail.Metadata>
          }
        />
      }
      actions={
        <ActionPanel title="Linear Bridge">
          <TaskEditMenu task={task} refetchList={refetchList} />
        </ActionPanel>
      }
    />
  );
};
