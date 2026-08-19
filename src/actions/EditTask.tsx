import { Action, ActionPanel, Form, showToast, Toast, useNavigation } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { FC } from "react";
import { PRIORITY_NAMES } from "../constants";
import { formatDateOnly } from "../date";
import {
  changeTaskState,
  renameTask,
  retrieveLabelsForTeam,
  retrieveStatesForTeam,
  updateDescription,
  updateDueDate,
  updateLabels,
  updatePriority,
} from "../storage";
import { Task, WorkflowStateType } from "../types";

type Props = {
  task: Task;
  refetchList: () => void;
};

type FormValues = {
  title: string;
  dueDate: Date | null;
  priority: string;
  description: string;
  stateId?: string;
  labelIds?: string[];
};

// Every field on one form, submitted together: the earlier design split each field into
// its own push-a-screen-change-one-thing-pop-back action, which meant a task that needed
// (say) a new due date, priority, and status took three separate round trips. Status/Labels
// only apply to tasks with a Linear team, so they're omitted for local-only tasks rather
// than shown disabled.
export const EditTask: FC<Props> = ({ task, refetchList }) => {
  const { pop } = useNavigation();
  const hasTeam = Boolean(task.teamId);

  const { isLoading: isLoadingStates, data: states } = useCachedPromise(
    (teamId: string | undefined) => (teamId ? retrieveStatesForTeam(teamId) : Promise.resolve([])),
    [task.teamId],
    { initialData: [] },
  );
  const { isLoading: isLoadingLabels, data: labels } = useCachedPromise(
    (teamId: string | undefined) => (teamId ? retrieveLabelsForTeam(teamId) : Promise.resolve([])),
    [task.teamId],
    { initialData: [] },
  );

  const handleSubmit = async (values: FormValues) => {
    try {
      if (values.title && values.title !== task.title) {
        await renameTask(task.id, values.title);
      }

      const newDueDate = values.dueDate ? formatDateOnly(values.dueDate) : undefined;
      if (newDueDate !== task.dueDate) {
        await updateDueDate(task.id, newDueDate);
      }

      const newPriority = Number(values.priority);
      if (newPriority !== task.priority) {
        await updatePriority(task.id, newPriority);
      }

      const newDescription = values.description || undefined;
      if (newDescription !== task.description) {
        await updateDescription(task.id, newDescription);
      }

      if (hasTeam && values.stateId && values.stateId !== task.stateId) {
        const state = states.find((s) => s.id === values.stateId);
        if (state) {
          await changeTaskState(task.id, state.id, state.name, state.type as WorkflowStateType);
        }
      }

      if (hasTeam && values.labelIds) {
        const sameLabels =
          values.labelIds.length === task.labelIds.length && values.labelIds.every((id) => task.labelIds.includes(id));
        if (!sameLabels) {
          await updateLabels(task.id, values.labelIds);
        }
      }

      refetchList();
      pop();
      await showToast({ style: Toast.Style.Success, title: "Updated task", message: values.title });
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to update task",
        message: e instanceof Error ? e.message : undefined,
      });
    }
  };

  return (
    <Form
      isLoading={hasTeam && (isLoadingStates || isLoadingLabels)}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Changes" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField id="title" title="Task Name" defaultValue={task.title} />
      <Form.DatePicker
        id="dueDate"
        title="Due Date"
        type={Form.DatePicker.Type.Date}
        defaultValue={task.dueDate ? new Date(task.dueDate) : undefined}
      />
      <Form.Dropdown id="priority" title="Priority" defaultValue={String(task.priority)}>
        {Object.entries(PRIORITY_NAMES).map(([value, name]) => (
          <Form.Dropdown.Item key={value} value={value} title={name} />
        ))}
      </Form.Dropdown>
      {hasTeam && (
        <Form.Dropdown id="stateId" title="Status" defaultValue={task.stateId}>
          {[...states]
            .sort((a, b) => a.position - b.position)
            .map((state) => (
              <Form.Dropdown.Item key={state.id} value={state.id} title={state.name} />
            ))}
        </Form.Dropdown>
      )}
      {hasTeam && (
        <Form.TagPicker id="labelIds" title="Labels" defaultValue={task.labelIds}>
          {labels.map((label) => (
            <Form.TagPicker.Item key={label.id} value={label.id} title={label.name} />
          ))}
        </Form.TagPicker>
      )}
      <Form.TextArea id="description" title="Description" defaultValue={task.description ?? ""} />
    </Form>
  );
};
