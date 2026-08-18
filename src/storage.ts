import { getCachedTasks, setCachedTasks } from "./repository/localCache";
import { fetchAssignedIssues } from "./repository/linearApi";
import { Task } from "./types";

export async function retrieveCachedItems(): Promise<Task[]> {
  return getCachedTasks();
}

export async function refreshItemsFromLinear(): Promise<Task[]> {
  const tasks = await fetchAssignedIssues();
  await setCachedTasks(tasks);
  return tasks;
}
