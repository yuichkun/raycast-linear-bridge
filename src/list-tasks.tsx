import { Color, Icon, List } from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import { useSearch } from "./hooks/useSearch";
import { runSync } from "./sync/runSync";
import { retrieveCachedItems } from "./storage";
import { groupTasksBySection } from "./task-order";
import { TaskLineItem } from "./TaskLineItem";
import { Task } from "./types";

export default function Command() {
  const [tasks, setTasks] = useState<Task[]>([]);
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
    const cached = await retrieveCachedItems();
    setTasks(cached);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const cached = await retrieveCachedItems();
      if (cancelled) return;
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
  // Memoized so this is a stable reference across renders that don't change `tasks` —
  // useSearch below depends on it, and a fresh array every render fed into an effect is
  // exactly what caused an infinite render loop before.
  const visibleTasks = useMemo(() => tasks.filter((task) => !task.archivedLocally), [tasks]);

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

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={isShowingDetail}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search by anything. Task title, label, team, date, etc."
    >
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
