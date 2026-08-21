import { readJsonFile, writeJsonFile } from "./fileStore";

// User-level extension settings, stored in environment.supportPath for the same reason as
// the tasks cache: Raycast's own "Clear Local Storage & Cache" debug action shares its
// default shortcut with Archive Task, and an accidental press shouldn't silently reset
// settings. A single JSON object (not one file per setting) so future settings share the
// same read-modify-write path.
export type ExtensionSettings = {
  // Teams whose tasks List Tasks shows — an explicit allow-list. Empty means no filtering
  // at all (every team shows), so a fresh install starts with the full list rather than a
  // blank one.
  visibleTeamIds: string[];
};

const SETTINGS_FILE = "settings.json";
const DEFAULT_SETTINGS: ExtensionSettings = { visibleTeamIds: [] };

export async function getVisibleTeamIds(): Promise<string[]> {
  const settings = await readJsonFile<ExtensionSettings>(SETTINGS_FILE, DEFAULT_SETTINGS);
  return settings.visibleTeamIds ?? [];
}

export async function setVisibleTeamIds(teamIds: string[]): Promise<void> {
  const settings = await readJsonFile<ExtensionSettings>(SETTINGS_FILE, DEFAULT_SETTINGS);
  await writeJsonFile(SETTINGS_FILE, { ...settings, visibleTeamIds: teamIds });
}
