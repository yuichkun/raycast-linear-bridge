import { Color, Icon, List } from "@raycast/api";
import { useEffect, useState } from "react";
import { refreshItemsFromLinear, retrieveCachedItems } from "./storage";
import { Task } from "./types";

export default function Command() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();

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
    <List isLoading={isLoading}>
      {tasks.map((task) => (
        <List.Item key={task.id} title={task.title} />
      ))}
    </List>
  );
}
