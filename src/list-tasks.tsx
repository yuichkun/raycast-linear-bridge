import { ActionPanel, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useEffect, useMemo, useState } from "react";
import { FilterTeamsAction } from "./actions/FilterTeams";
import { DueHorizon, parseDueHorizon } from "./date";
import { useSearch } from "./hooks/useSearch";
import { retrieveCachedItems, retrieveDueHorizon, retrieveVisibleTeamIds, updateDueHorizon } from "./storage";
import { runSync } from "./sync/runSync";
import { groupTasksBySection, restrictToDueHorizon, restrictToVisibleTeams } from "./task-order";
import { TaskLineItem } from "./TaskLineItem";
import { Task } from "./types";

// One shared instance rather than a fresh [] per render: visibleTasks and the search
// results are memoized on the task array, and a new array every render would recompute
// both on every render for as long as the cache is still loading.
const NO_TASKS: Task[] = [];

const DUE_HORIZON_TITLES: Record<DueHorizon, string> = {
  all: "All",
  today: "Due Today",
  "7days": "Due Within 7 Days",
  "30days": "Due Within 30 Days",
};

export default function Command() {
  // The list shows the tasks cache on disk, nothing else. The sync never feeds it directly:
  // the pull writes to the cache, and the list re-reads the cache once the sync is done.
  // Mutations write to the cache too, before calling refetchList, so a change is on screen
  // as soon as the cache is re-read and reaches Linear on the sync that follows. Being
  // offline is not an error — runSync reports it in its result and leaves the cache as it
  // was — so the only sync that gets a toast is one Linear actually rejected.
  const cache = usePromise(retrieveCachedItems, [], {
    failureToastOptions: { title: "Couldn't read the task cache" },
  });
  const sync = usePromise(runSync, [], {
    onData: async () => {
      await cache.revalidate();
    },
    failureToastOptions: { title: "Couldn't sync with Linear" },
  });
  const tasks = cache.data ?? NO_TASKS;
  // The progress bar only while there's nothing to show yet: Raycast never shows an
  // EmptyView while isLoading is true, so keeping it on through every sync would take the
  // empty view's actions away each time.
  const isLoading = cache.isLoading || (tasks.length === 0 && sync.isLoading);
  const isOffline = sync.data?.networkUnreachable === true;

  const [visibleTeamIds, setVisibleTeamIds] = useState<string[]>([]);
  const [dueHorizon, setDueHorizon] = useState<DueHorizon>("all");
  // Off by default: a full detail pane next to every row crowds the list when you're just
  // scanning titles. ⌘D turns it on for whoever wants it open persistently.
  const [isShowingDetail, setIsShowingDetail] = useState(false);

  async function reloadSettings() {
    const [visible, horizon] = await Promise.all([retrieveVisibleTeamIds(), retrieveDueHorizon()]);
    setVisibleTeamIds(visible);
    setDueHorizon(horizon);
  }

  // Every mutation (Mark Complete, Rename, Filter Teams, ...) calls this right after
  // writing to the cache, queue or settings.
  function refetchList() {
    reloadSettings();
    cache.revalidate();
    sync.revalidate();
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
    reloadSettings();
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

  const filterCount = visibleTeamIds.length;
  const isHorizonActive = dueHorizon !== "all";

  let emptyDescription = "Create a task to get going.";
  if (tasks.length === 0 && isOffline) {
    emptyDescription = "Couldn't reach Linear, and nothing is cached yet.";
  } else if (filterCount > 0 && isHorizonActive) {
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
