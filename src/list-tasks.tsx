import { Color, Icon, List } from "@raycast/api";
import { useEffect, useState } from "react";
import { useSearch } from "./hooks/useSearch";
import { processQueue } from "./sync/processQueue";
import { refreshItemsFromLinear, retrieveCachedItems } from "./storage";
import { groupTasksBySection, TaskSection } from "./task-order";
import { TaskLineItem } from "./TaskLineItem";
import { Task } from "./types";

export default function Command() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();

  async function refetchList() {
    // Fire-and-forget: every mutation (Mark Complete, Rename, ...) calls refetchList()
    // right after writing to the local cache + queue, so kicking a sync attempt here
    // (rather than only on mount) means changes reach Linear immediately instead of
    // waiting for the next time this command happens to be opened.
    processQueue();
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
        const fresh = await refreshItemsFromLinear();
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

  useEffect(() => {
    // Fire-and-forget: flush any pending offline changes to Linear without blocking the UI.
    processQueue().then((result) => {
      if (!result.networkUnreachable && result.failures.length === 0) refetchList();
    });
  }, []);

  const { searchText, setSearchText, filteredItems } = useSearch(tasks);
  const filteredTaskIds = new Set(filteredItems.map((task) => task.id));
  const sections = groupTasksBySection(tasks);
  const visibleSections: Record<TaskSection, Task[]> = {
    // Preserve todo-buddy's behavior: outdated tasks ignore the active search filter,
    // so a past-due task never gets hidden by a search.
    outdated: sections.outdated,
    pinned: sections.pinned.filter((task) => filteredTaskIds.has(task.id)),
    incomplete: sections.incomplete.filter((task) => filteredTaskIds.has(task.id)),
    complete: sections.complete.filter((task) => filteredTaskIds.has(task.id)),
  };

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
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search by anything. Task title, label, team, date, etc."
    >
      <List.Section title="⚠️ Outdated" subtitle={`${visibleSections.outdated.length} tasks`}>
        {visibleSections.outdated.map((task) => (
          <TaskLineItem key={task.id} task={task} refetchList={refetchList} />
        ))}
      </List.Section>
      <List.Section title="📌 Pinned" subtitle={`${visibleSections.pinned.length} tasks`}>
        {visibleSections.pinned.map((task) => (
          <TaskLineItem key={task.id} task={task} refetchList={refetchList} />
        ))}
      </List.Section>
      <List.Section title="📝 Incomplete" subtitle={`${visibleSections.incomplete.length} tasks`}>
        {visibleSections.incomplete.map((task) => (
          <TaskLineItem key={task.id} task={task} refetchList={refetchList} />
        ))}
      </List.Section>
      <List.Section title="✅ Done" subtitle={`${visibleSections.complete.length} tasks`}>
        {visibleSections.complete.map((task) => (
          <TaskLineItem key={task.id} task={task} refetchList={refetchList} />
        ))}
      </List.Section>
    </List>
  );
}
