import { environment, LocalStorage } from "@raycast/api";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { join } from "path";

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

// Reads a JSON file from the extension's support directory (environment.supportPath) —
// a plain filesystem location Raycast's own "Clear Local Storage & Cache" developer action
// doesn't touch, unlike the LocalStorage/Cache APIs it's named after. Used for data that
// must survive that action (see repository/localCache.ts's tasks cache and syncQueue.ts).
//
// migrateFromLocalStorageKey handles the one-time cutover for existing installs: if the
// file doesn't exist yet but the old LocalStorage key does, the raw string is copied
// verbatim into the new file (no JSON.parse/stringify round-trip, so a migration can't
// itself introduce a data bug) and returned. Once the file exists, LocalStorage is never
// consulted again.
export async function readJsonFile<T>(filename: string, fallback: T, migrateFromLocalStorageKey?: string): Promise<T> {
  const filePath = join(environment.supportPath, filename);

  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  if (migrateFromLocalStorageKey) {
    const legacyRaw = await LocalStorage.getItem<string>(migrateFromLocalStorageKey);
    if (legacyRaw !== undefined) {
      await writeRawFile(filePath, legacyRaw);
      return JSON.parse(legacyRaw) as T;
    }
  }

  return fallback;
}

export async function writeJsonFile(filename: string, data: unknown): Promise<void> {
  const filePath = join(environment.supportPath, filename);
  await writeRawFile(filePath, JSON.stringify(data));
}

// Writes to a temp file first, then renames it into place. rename() on the same filesystem
// is atomic at the OS level, so a crash mid-write leaves the previous file intact (the
// rename simply never happens) instead of a half-written, corrupt one.
async function writeRawFile(filePath: string, contents: string): Promise<void> {
  await mkdir(environment.supportPath, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, contents, "utf-8");
  await rename(tmpPath, filePath);
}
