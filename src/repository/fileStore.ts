import { environment, LocalStorage } from "@raycast/api";
import { randomUUID } from "crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "fs/promises";
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

// Read-modify-write under a lock on the file. List Tasks and the scheduled Sync command
// are separate processes, so a plain read → change → write from each can interleave and
// the later write silently drops the earlier one's change — for tasks.json that can be a
// local-only task, which has no other copy anywhere.
//
// `update` returning `current` itself means "no change" and skips the write. Anything it
// awaits runs while the lock is held, so it must stay local (no Linear calls). Returns both
// sides so callers can act on what was actually replaced, e.g. queue an op for it.
export async function updateJsonFile<T>(
  filename: string,
  fallback: T,
  update: (current: T) => T | Promise<T>,
  migrateFromLocalStorageKey?: string,
): Promise<{ previous: T; next: T }> {
  const filePath = join(environment.supportPath, filename);
  return withFileLock(filePath, async () => {
    const previous = await readJsonFile(filename, fallback, migrateFromLocalStorageKey);
    const next = await update(previous);
    if (next !== previous) await writeRawFile(filePath, JSON.stringify(next));
    return { previous, next };
  });
}

// A lock is only ever held for a few local file operations, so one this old belongs to a
// process that died holding it (Raycast stops a background command that runs too long).
const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 20;

// mkdir fails if the directory already exists, atomically, on macOS and Windows alike, so
// whoever creates it holds the lock.
async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = `${filePath}.lock`;
  await mkdir(environment.supportPath, { recursive: true });
  for (;;) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }
    if (await isStaleLock(lockPath)) {
      await rm(lockPath, { recursive: true, force: true });
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
  }
  try {
    return await fn();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

async function isStaleLock(lockPath: string): Promise<boolean> {
  try {
    const { mtimeMs } = await stat(lockPath);
    return Date.now() - mtimeMs > LOCK_STALE_MS;
  } catch (error) {
    // Released between our mkdir and this stat: not stale, just retry.
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST";
}

// Writes to a temp file first, then renames it into place. rename() on the same filesystem
// is atomic at the OS level, so a crash mid-write leaves the previous file intact (the
// rename simply never happens) instead of a half-written, corrupt one.
//
// Each write gets its own temp file. The List Tasks view and the scheduled Sync command run
// as separate processes and can write the same file at once; with a shared temp path the
// shorter write lands over the start of the longer one, and the renamed file ends with the
// longer one's leftover tail — valid JSON followed by junk.
async function writeRawFile(filePath: string, contents: string): Promise<void> {
  await mkdir(environment.supportPath, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, contents, "utf-8");
  await rename(tmpPath, filePath);
}
