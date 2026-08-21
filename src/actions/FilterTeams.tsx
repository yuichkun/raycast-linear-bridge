import { Action, ActionPanel, Form, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import { useCachedPromise, usePromise } from "@raycast/utils";
import { FC } from "react";
import { retrieveTeams, retrieveVisibleTeamIds, updateVisibleTeamIds } from "../storage";

type Props = {
  refetchList: () => void;
};

// A custom Form rather than a native Raycast preference: manifest preference dropdowns
// only accept a static data array hardcoded in package.json, and the team list is runtime
// data from the user's Linear workspace — there is no way to enumerate it in the native
// preferences screen. Teams come from the cache (retrieveTeams), so this form is fully
// usable offline.
export const FilterTeams: FC<Props> = ({ refetchList }) => {
  const { pop } = useNavigation();
  const { data: teams, isLoading: isLoadingTeams } = useCachedPromise(retrieveTeams, [], { initialData: [] });
  // usePromise rather than useCachedPromise: the current selection must be read fresh from
  // disk every time the form opens. A cached value from a previous open would seed
  // defaultValue (applied once per component lifecycle) with stale data right after the
  // user changes the filter and reopens the form.
  const { data: visibleTeamIds } = usePromise(retrieveVisibleTeamIds, []);

  const handleSubmit = async (values: { visibleTeamIds: string[] }) => {
    try {
      await updateVisibleTeamIds(values.visibleTeamIds);
      refetchList();
      pop();
      const count = values.visibleTeamIds.length;
      await showToast({
        style: Toast.Style.Success,
        title: "Updated team filter",
        message: count > 0 ? `Showing ${count} ${count === 1 ? "team" : "teams"} only` : "Showing all teams",
      });
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to update team filter",
        message: e instanceof Error ? e.message : undefined,
      });
    }
  };

  // The picker only mounts once the stored selection is known — Form.TagPicker's
  // defaultValue is applied a single time, so mounting it before the read completes would
  // lock in an empty selection.
  if (visibleTeamIds === undefined) {
    return <Form isLoading />;
  }

  return (
    <Form
      isLoading={isLoadingTeams}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Team Filter" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description text="Only tasks from the selected teams are shown in List Tasks — leave the selection empty to show every team. The filter applies everywhere, Outdated and Done included. Local-only tasks are always shown." />
      <Form.TagPicker id="visibleTeamIds" title="Visible Teams" defaultValue={visibleTeamIds}>
        {teams.map((team) => (
          <Form.TagPicker.Item key={team.id} value={team.id} title={team.name} />
        ))}
      </Form.TagPicker>
    </Form>
  );
};

export const FilterTeamsAction: FC<Props> = ({ refetchList }) => (
  <Action.Push
    title="Filter Teams"
    icon={Icon.Filter}
    shortcut={{
      macOS: { modifiers: ["cmd", "shift"], key: "f" },
      Windows: { modifiers: ["ctrl", "shift"], key: "f" },
    }}
    target={<FilterTeams refetchList={refetchList} />}
  />
);
