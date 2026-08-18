import { LocalStorage } from "@raycast/api";
import { Task } from "../types";

const CACHE_KEY = "tasks";

export async function getCachedTasks(): Promise<Task[]> {
  const raw = await LocalStorage.getItem<string>(CACHE_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function setCachedTasks(tasks: Task[]): Promise<void> {
  await LocalStorage.setItem(CACHE_KEY, JSON.stringify(tasks));
}
