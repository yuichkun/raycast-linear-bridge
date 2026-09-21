import { Action, ActionPanel, Form, launchCommand, LaunchType, showToast, Toast, useNavigation } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { useState } from "react";
import { PRIORITY_NAMES } from "./constants";
import { formatDateOnly } from "./date";
import { useTeamAndStatusPicker } from "./hooks/useTeamAndStatusPicker";
import { DEFAULT_LOCAL_STAGE, findLocalStage, LOCAL_STAGES } from "./localStages";
import ListTasks from "./list-tasks";
import { createTask, retrieveLabelsForTeam } from "./storage";
import { WorkflowStateType } from "./types";

type FormValues = {
  title: string;
  saveToLinear: boolean;
  teamId: string;
  stateId: string;
  localStage: WorkflowStateType;
  labelIds: string[];
  priority: string;
  description: string;
  dueDate: Date | null;
};

export default function Command() {
  const { push } = useNavigation();
  const [saveToLinear, setSaveToLinear] = useState(false);
  const {
    teams,
    states,
    teamId,
    setTeamId,
    stateId,
    setStateId,
    isLoading: isLoadingTeamAndStatus,
  } = useTeamAndStatusPicker();

  const { isLoading: isLoadingLabels, data: labels } = useCachedPromise(
    (id: string | undefined) => (id ? retrieveLabelsForTeam(id) : Promise.resolve([])),
    [teamId],
    { initialData: [] },
  );

  // Hands over to List Tasks as its own command instead of pushing its view onto this one. A
  // pushed view still counts as Create Task to Raycast 2, so pressing the Create Task hotkey to
  // add the next task toggled the window shut — and reopened it on the same list — rather than
  // opening a fresh form.
  async function showTaskList() {
    try {
      await launchCommand({ name: "list-tasks", type: LaunchType.UserInitiated });
    } catch {
      // launchCommand rejects when List Tasks has been disabled; its view still works pushed.
      push(<ListTasks />);
    }
  }

  async function handleSubmit(values: FormValues) {
    if (!values.title) {
      await showToast({ style: Toast.Style.Failure, title: "Task name is required" });
      return;
    }
    if (values.saveToLinear && !values.teamId) {
      await showToast({ style: Toast.Style.Failure, title: "Team is required when saving to Linear" });
      return;
    }

    try {
      const selectedTeam = teams.find((team) => team.id === values.teamId);
      const selectedState = states.find((state) => state.id === values.stateId);
      const selectedLocalStage = findLocalStage(values.localStage) ?? DEFAULT_LOCAL_STAGE;
      const selectedLabelNames = labels.filter((label) => values.labelIds?.includes(label.id)).map((l) => l.name);

      await createTask({
        title: values.title,
        saveToLinear: values.saveToLinear,
        teamId: values.saveToLinear ? values.teamId : undefined,
        teamName: values.saveToLinear ? selectedTeam?.name : undefined,
        stateId: values.saveToLinear ? selectedState?.id : undefined,
        stateName: values.saveToLinear ? selectedState?.name : selectedLocalStage.name,
        stateType: values.saveToLinear
          ? (selectedState?.type as WorkflowStateType | undefined)
          : selectedLocalStage.type,
        statePosition: values.saveToLinear ? selectedState?.position : undefined,
        description: values.description || undefined,
        dueDate: values.dueDate ? formatDateOnly(values.dueDate) : undefined,
        priority: values.saveToLinear && values.priority ? Number(values.priority) : undefined,
        labelIds: values.saveToLinear ? values.labelIds : undefined,
        labelNames: values.saveToLinear ? selectedLabelNames : undefined,
      });

      await showToast({ style: Toast.Style.Success, title: "Created task", message: values.title });
      await showTaskList();
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to create task",
        message: e instanceof Error ? e.message : undefined,
      });
    }
  }

  return (
    <Form
      isLoading={isLoadingTeamAndStatus || isLoadingLabels}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Create Task" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField id="title" title="Task Name" />
      <Form.Checkbox
        id="saveToLinear"
        label="Save to Linear"
        value={saveToLinear}
        onChange={setSaveToLinear}
        info="Off by default: the task stays local-only and is never sent to Linear. Turn this on to create a real Linear issue instead — you can also promote a local task to Linear later."
      />
      {saveToLinear ? (
        <>
          <Form.Dropdown id="teamId" title="Team" value={teamId} onChange={setTeamId}>
            {teams.map((team) => (
              <Form.Dropdown.Item key={team.id} value={team.id} title={team.name} />
            ))}
          </Form.Dropdown>
          <Form.Dropdown id="stateId" title="Status" value={stateId} onChange={setStateId}>
            {states.map((state) => (
              <Form.Dropdown.Item key={state.id} value={state.id} title={state.name} />
            ))}
          </Form.Dropdown>
          <Form.TagPicker id="labelIds" title="Labels">
            {labels.map((label) => (
              <Form.TagPicker.Item key={label.id} value={label.id} title={label.name} />
            ))}
          </Form.TagPicker>
          <Form.Dropdown id="priority" title="Priority" defaultValue="0">
            {Object.entries(PRIORITY_NAMES).map(([value, name]) => (
              <Form.Dropdown.Item key={value} value={value} title={name} />
            ))}
          </Form.Dropdown>
        </>
      ) : (
        <Form.Dropdown id="localStage" title="Status" defaultValue={DEFAULT_LOCAL_STAGE.type}>
          {LOCAL_STAGES.map((stage) => (
            <Form.Dropdown.Item key={stage.type} value={stage.type} title={stage.name} />
          ))}
        </Form.Dropdown>
      )}
      <Form.TextArea id="description" title="Description" />
      <Form.DatePicker id="dueDate" title="Due Date" type={Form.DatePicker.Type.Date} />
    </Form>
  );
}
