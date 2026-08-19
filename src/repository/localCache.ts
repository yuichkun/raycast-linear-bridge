import { LocalStorage } from "@raycast/api";
import { Task } from "../types";

const TASKS_CACHE_KEY = "tasks";
const TEAM_LABELS_CACHE_KEY = "teamLabels";
const TEAM_STATES_CACHE_KEY = "teamStates";
const TEAMS_CACHE_KEY = "teams";

export async function getCachedTasks(): Promise<Task[]> {
  const raw = await LocalStorage.getItem<string>(TASKS_CACHE_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function setCachedTasks(tasks: Task[]): Promise<void> {
  await LocalStorage.setItem(TASKS_CACHE_KEY, JSON.stringify(tasks));
}

export type CachedLabel = { id: string; name: string };

export async function getCachedTeamLabels(): Promise<Map<string, CachedLabel[]>> {
  const raw = await LocalStorage.getItem<string>(TEAM_LABELS_CACHE_KEY);
  if (!raw) return new Map();
  const entries: [string, CachedLabel[]][] = JSON.parse(raw);
  return new Map(entries);
}

export async function setCachedTeamLabels(teamLabels: Map<string, CachedLabel[]>): Promise<void> {
  await LocalStorage.setItem(TEAM_LABELS_CACHE_KEY, JSON.stringify([...teamLabels.entries()]));
}

export type CachedState = { id: string; name: string; type: string; position: number };

export async function getCachedTeamStates(): Promise<Map<string, CachedState[]>> {
  const raw = await LocalStorage.getItem<string>(TEAM_STATES_CACHE_KEY);
  if (!raw) return new Map();
  const entries: [string, CachedState[]][] = JSON.parse(raw);
  return new Map(entries);
}

export async function setCachedTeamStates(teamStates: Map<string, CachedState[]>): Promise<void> {
  await LocalStorage.setItem(TEAM_STATES_CACHE_KEY, JSON.stringify([...teamStates.entries()]));
}

export type CachedTeam = { id: string; name: string };

export async function getCachedTeams(): Promise<CachedTeam[]> {
  const raw = await LocalStorage.getItem<string>(TEAMS_CACHE_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function setCachedTeams(teams: CachedTeam[]): Promise<void> {
  await LocalStorage.setItem(TEAMS_CACHE_KEY, JSON.stringify(teams));
}
