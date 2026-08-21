import { ActionPanel, Color, Icon, List } from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import { FilterTeamsAction } from "./actions/FilterTeams";
import { useSearch } from "./hooks/useSearch";
import { runSync } from "./sync/runSync";
import { retrieveCachedItems, retrieveVisibleTeamIds } from "./storage";
import { groupTasksBySection, restrictToVisibleTeams } from "./task-order";
import { TaskLineItem } from "./TaskLineItem";
import { Task } from "./types";

export default function Command() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [visibleTeamIds, setVisibleTeamIds] = useState<string[]>([]);
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
    const [cached, visible] = await Promise.all([retrieveCachedItems(), retrieveVisibleTeamIds()]);
    setTasks(cached);
    setVisibleTeamIds(visible);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [cached, visible] = await Promise.all([retrieveCachedItems(), retrieveVisibleTeamIds()]);
      if (cancelled) return;
      setVisibleTeamIds(visible);
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
  // The team filter applies here too, before search — a filtered-out team's tasks
  // shouldn't be reachable via the search index either. Memoized so this is a stable
  // reference across renders that don't change the inputs — useSearch below depends on
  // it, and a fresh array every render fed into an effect is exactly what caused an
  // infinite render loop before.
  const visibleTasks = useMemo(
    () =>
      restrictToVisibleTeams(
        tasks.filter((task) => !task.archivedLocally),
        visibleTeamIds,
      ),
    [tasks, visibleTeamIds],
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

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={isShowingDetail}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search by anything. Task title, label, team, date, etc."
      // Always-visible reminder that the list is filtered — a filter saved weeks ago must
      // not read as "my tasks disappeared".
      navigationTitle={
        filterCount > 0 ? `List Tasks — filtered to ${filterCount} ${filterCount === 1 ? "team" : "teams"}` : undefined
      }
    >
      {/* Escape hatch for when the team filter (or an empty workspace) leaves nothing to
          select: with no rows there'd otherwise be no ActionPanel to reach Filter Teams
          from, locking the filter in place. */}
      <List.EmptyView
        title="No Tasks to Show"
        description={
          filterCount > 0
            ? "The team filter is on — press ⌘⇧F to adjust which teams are shown."
            : "Create a task to get going."
        }
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
