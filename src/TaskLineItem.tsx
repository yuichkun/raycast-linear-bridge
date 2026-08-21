import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { FC } from "react";
import { FilterTeamsAction } from "./actions/FilterTeams";
import { TaskDetailView } from "./actions/TaskDetailView";
import { TaskEditMenu } from "./actions/edit";
import { PRIORITY_COLORS, PRIORITY_ICONS } from "./constants";
import { nameToColor } from "./nameToColor";
import { classifyTask } from "./task-order";
import { taskDetailMarkdown, TaskMetadata } from "./TaskMetadata";
import { Task } from "./types";

type Props = {
  task: Task;
  refetchList: () => void;
  isShowingDetail: boolean;
  onToggleDetail: () => void;
};

export const TaskLineItem: FC<Props> = ({ task, refetchList, isShowingDetail, onToggleDetail }) => {
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
        ...task.labelNames.map((name) => ({ tag: { value: name, color: nameToColor(name) } })),
        { tag: showStateTag && task.stateName ? { value: task.stateName } : null },
        { text: task.dueDate ? new Date(task.dueDate).toLocaleDateString() : null },
      ]}
      detail={<List.Item.Detail markdown={taskDetailMarkdown(task)} metadata={<TaskMetadata task={task} />} />}
      actions={
        <ActionPanel title="Linear Bridge">
          <Action.Push
            title="View Task"
            icon={Icon.Maximize}
            target={<TaskDetailView taskId={task.id} refetchList={refetchList} />}
          />
          <TaskEditMenu task={task} refetchList={refetchList} />
          <Action
            title={isShowingDetail ? "Hide Details" : "Show Details"}
            icon={Icon.Sidebar}
            shortcut={{
              macOS: { modifiers: ["cmd"], key: "d" },
              Windows: { modifiers: ["ctrl"], key: "d" },
            }}
            onAction={onToggleDetail}
          />
          <FilterTeamsAction refetchList={refetchList} />
        </ActionPanel>
      }
    />
  );
};
