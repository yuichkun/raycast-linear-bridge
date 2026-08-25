import { DueHorizon, parseDueHorizon } from "../date";
import { readJsonFile, writeJsonFile } from "./fileStore";

// User-level extension settings, stored in environment.supportPath for the same reason as
// the tasks cache: Raycast's own "Clear Local Storage & Cache" debug action shares its
// default shortcut with Archive Task, and an accidental press shouldn't silently reset
// settings. A single JSON object (not one file per setting) so every setting shares the
// same read-modify-write path.
export type ExtensionSettings = {
  // Teams whose tasks List Tasks shows — an explicit allow-list. Empty means no filtering
  // at all (every team shows), so a fresh install starts with the full list rather than a
  // blank one.
  visibleTeamIds: string[];
  // How far ahead List Tasks looks by due date (see date.ts). "all" means no filtering.
  dueHorizon: DueHorizon;
};

const SETTINGS_FILE = "settings.json";
const DEFAULT_SETTINGS: ExtensionSettings = { visibleTeamIds: [], dueHorizon: "all" };

async function readSettings(): Promise<ExtensionSettings> {
  return readJsonFile<ExtensionSettings>(SETTINGS_FILE, DEFAULT_SETTINGS);
}

export async function getVisibleTeamIds(): Promise<string[]> {
  const settings = await readSettings();
  return settings.visibleTeamIds ?? [];
}

export async function setVisibleTeamIds(teamIds: string[]): Promise<void> {
  const settings = await readSettings();
  await writeJsonFile(SETTINGS_FILE, { ...settings, visibleTeamIds: teamIds });
}

export async function getDueHorizon(): Promise<DueHorizon> {
  const settings = await readSettings();
  return parseDueHorizon(settings.dueHorizon);
}

export async function setDueHorizon(horizon: DueHorizon): Promise<void> {
  const settings = await readSettings();
  await writeJsonFile(SETTINGS_FILE, { ...settings, dueHorizon: horizon });
}
