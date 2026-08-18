import { Color, Icon, List } from "@raycast/api";
import { useEffect, useState } from "react";
import { retrieveAllItems } from "./storage";
import { Task } from "./types";

export default function Command() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    async function load() {
      try {
        const items = await retrieveAllItems();
        setTasks(items);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to fetch issues from Linear");
      } finally {
        setIsLoading(false);
      }
    }
    load();
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
