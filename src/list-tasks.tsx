import { ActionPanel, Color, Icon, List } from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import { FilterTeamsAction } from "./actions/FilterTeams";
import { DueHorizon, parseDueHorizon } from "./date";
import { useSearch } from "./hooks/useSearch";
import { runSync } from "./sync/runSync";
import { retrieveCachedItems, retrieveDueHorizon, retrieveVisibleTeamIds, updateDueHorizon } from "./storage";
import { groupTasksBySection, restrictToDueHorizon, restrictToVisibleTeams } from "./task-order";
import { TaskLineItem } from "./TaskLineItem";
import { Task } from "./types";

const DUE_HORIZON_TITLES: Record<DueHorizon, string> = {
  all: "All",
  today: "Due Today",
  week: "Due This Week",
  month: "Due This Month",
};

export default function Command() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [visibleTeamIds, setVisibleTeamIds] = useState<string[]>([]);
  const [dueHorizon, setDueHorizon] = useState<DueHorizon>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();
  // Off by default: a full detail pane next to every row crowds the list when you're just
  // scanning titles. ⌘D turns it on for whoever wants it open persistently.
  const [isShowingDetail, setIsShowingDetail] = useState(false);

  async function refetchList() {
    // Fire-and-forget: every mutation (Mark Complete, Rename, ...) calls refetchList()
    // right after writing to the local cache + queue, so kicking a sync attempt here
    // (rather than only on mount) means changes reach Linear immediately instead of
    // waiting for the next time this command happens to be opened.
    runSync();
    const [cached, visible, horizon] = await Promise.all([
      retrieveCachedItems(),
      retrieveVisibleTeamIds(),
      retrieveDueHorizon(),
    ]);
    setTasks(cached);
    setVisibleTeamIds(visible);
    setDueHorizon(horizon);
  }

  // The dropdown is controlled (value from settings.json, like the team filter) rather
  // than relying on List.Dropdown's own storeValue, so the choice survives Raycast's
  // "Clear Local Storage & Cache" and there's one source of truth. Raycast may call
  // onChange with the current value on render; only a genuine change hits disk, which
  // also stops an initial "all" from clobbering the stored horizon before it's loaded.
  async function handleDueHorizonChange(value: string) {
    const horizon = parseDueHorizon(value);
    if (horizon === dueHorizon) return;
    setDueHorizon(horizon);
    await updateDueHorizon(horizon);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [cached, visible, horizon] = await Promise.all([
        retrieveCachedItems(),
        retrieveVisibleTeamIds(),
        retrieveDueHorizon(),
      ]);
      if (cancelled) return;
      setVisibleTeamIds(visible);
      setDueHorizon(horizon);
      if (cached.length > 0) {
        setTasks(cached);
        setIsLoading(false);
      }

      try {
        const { tasks: fresh } = await runSync();
        if (cancelled) return;
        setTasks(fresh);
        setError(undefined);
      } catch (e) {
        if (cancelled) return;
        // Cached tasks are still shown even if the background refresh fails (e.g. offline).
        if (cached.length === 0) {
          setError(e instanceof Error ? e.message : "Failed to fetch issues from Linear");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Archived tasks stay in the cache (so a failed archive can be rolled back accurately)
  // but are never shown, whether the archive is still pending sync or already confirmed.
  // The team and due-horizon filters apply here too, before search — a filtered-out
  // task shouldn't be reachable via the search index either. Memoized so this is a
  // stable reference across renders that don't change the inputs — useSearch below
  // depends on it, and a fresh array every render fed into an effect is exactly what
  // caused an infinite render loop before.
  const visibleTasks = useMemo(
    () =>
      restrictToDueHorizon(
        restrictToVisibleTeams(
          tasks.filter((task) => !task.archivedLocally),
          visibleTeamIds,
        ),
        dueHorizon,
      ),
    [tasks, visibleTeamIds, dueHorizon],
  );

  const { searchText, setSearchText, filteredItems } = useSearch(visibleTasks);
  const filteredTaskIds = new Set(filteredItems.map((task) => task.id));
  const sections = groupTasksBySection(visibleTasks);
  const visibleSections = sections.map((section) => ({
    ...section,
    // Preserve todo-buddy's behavior: outdated tasks ignore the active search filter,
    // so a past-due task never gets hidden by a search.
    tasks: section.key === "outdated" ? section.tasks : section.tasks.filter((task) => filteredTaskIds.has(task.id)),
  }));

  if (error) {
    return (
      <List>
        <List.EmptyView
          icon={{ source: Icon.ExclamationMark, tintColor: Color.Red }}
          title="Failed to connect to Linear"
          description={error}
        />
      </List>
    );
  }

  const filterCount = visibleTeamIds.length;
  const isHorizonActive = dueHorizon !== "all";

  let emptyDescription = "Create a task to get going.";
  if (filterCount > 0 && isHorizonActive) {
    emptyDescription = "Filters are on — check the due dropdown and the team filter (⌘⇧F).";
  } else if (filterCount > 0) {
    emptyDescription = "The team filter is on — press ⌘⇧F to adjust which teams are shown.";
  } else if (isHorizonActive) {
    emptyDescription = `Nothing due within "${DUE_HORIZON_TITLES[dueHorizon]}" — switch the dropdown to All to see every task.`;
  }

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={isShowingDetail}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search by anything. Task title, label, team, date, etc."
      // Always-visible reminder that the list is filtered — a filter saved weeks ago must
      // not read as "my tasks disappeared". The due horizon needs no equivalent: its
      // dropdown sits in the search bar and shows the active choice at all times.
      navigationTitle={
        filterCount > 0 ? `List Tasks — filtered to ${filterCount} ${filterCount === 1 ? "team" : "teams"}` : undefined
      }
      // A dropdown rather than the search text: the search box is a single fuzzy query, so
      // typing "today" there both had to be repeated every launch and blocked searching
      // for anything else at the same time.
      searchBarAccessory={
        <List.Dropdown tooltip="Show tasks due by" value={dueHorizon} onChange={handleDueHorizonChange}>
          {(Object.keys(DUE_HORIZON_TITLES) as DueHorizon[]).map((horizon) => (
            <List.Dropdown.Item key={horizon} value={horizon} title={DUE_HORIZON_TITLES[horizon]} />
          ))}
        </List.Dropdown>
      }
    >
      {/* Escape hatch for when the filters (or an empty workspace) leave nothing to
          select: with no rows there'd otherwise be no ActionPanel to reach Filter Teams
          from, locking the filter in place. */}
      <List.EmptyView
        title="No Tasks to Show"
        description={emptyDescription}
        actions={
          <ActionPanel>
            <FilterTeamsAction refetchList={refetchList} />
          </ActionPanel>
        }
      />
      {visibleSections.map((section) => (
        <List.Section key={section.key} title={section.title} subtitle={`${section.tasks.length} tasks`}>
          {section.tasks.map((task) => (
            <TaskLineItem
              key={task.id}
              task={task}
              refetchList={refetchList}
              isShowingDetail={isShowingDetail}
              onToggleDetail={() => setIsShowingDetail((current) => !current)}
            />
          ))}
        </List.Section>
      ))}
    </List>
  );
}
