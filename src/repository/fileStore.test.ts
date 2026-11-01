import { environment, LocalStorage } from "@raycast/api";
import { mkdir, mkdtemp, readdir, readFile, rm, utimes } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readJsonFile, updateJsonFile, writeJsonFile } from "./fileStore";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "linear-bridge-test-"));
  environment.supportPath = dir;
  vi.mocked(LocalStorage.getItem).mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readJsonFile / writeJsonFile", () => {
  it("round-trips data written to disk", async () => {
    await writeJsonFile("tasks.json", [{ id: "1" }]);

    const result = await readJsonFile("tasks.json", []);

    expect(result).toEqual([{ id: "1" }]);
  });

  it("returns the fallback when the file doesn't exist and there's no legacy key to migrate from", async () => {
    const result = await readJsonFile("missing.json", "fallback-value");

    expect(result).toBe("fallback-value");
  });

  it("returns the fallback when the file doesn't exist and the legacy LocalStorage key is also empty", async () => {
    vi.mocked(LocalStorage.getItem).mockResolvedValue(undefined);

    const result = await readJsonFile("tasks.json", [], "tasks");

    expect(result).toEqual([]);
  });

  it("migrates from LocalStorage verbatim when the file doesn't exist yet but legacy data does", async () => {
    const legacy = [{ id: "legacy-task" }];
    vi.mocked(LocalStorage.getItem).mockResolvedValue(JSON.stringify(legacy));

    const result = await readJsonFile("tasks.json", [], "tasks");

    expect(result).toEqual(legacy);
    // and it must now be persisted to disk, not just returned in memory
    const onDisk = JSON.parse(await readFile(join(dir, "tasks.json"), "utf-8"));
    expect(onDisk).toEqual(legacy);
  });

  it("never touches LocalStorage once the file already exists", async () => {
    await writeJsonFile("tasks.json", [{ id: "fresh" }]);
    vi.mocked(LocalStorage.getItem).mockClear();

    await readJsonFile("tasks.json", [], "tasks");

    expect(LocalStorage.getItem).not.toHaveBeenCalled();
  });

  it("leaves no .tmp file behind after a successful write", async () => {
    await writeJsonFile("tasks.json", [{ id: "1" }]);

    const files = await readdir(dir);

    expect(files).toEqual(["tasks.json"]);
  });

  it("leaves a parseable file when a long and a short write overlap", async () => {
    // The List Tasks view and the scheduled Sync command can write tasks.json at the same
    // time. If both share one temp path, the shorter write lands over the start of the
    // longer one and the renamed file ends with the longer one's leftover tail.
    const long = Array.from({ length: 5000 }, (_, i) => ({ id: `long-${i}` }));
    const short = [{ id: "short" }];

    await Promise.all([writeJsonFile("tasks.json", long), writeJsonFile("tasks.json", short)]);

    const raw = await readFile(join(dir, "tasks.json"), "utf-8");
    expect([long, short]).toContainEqual(JSON.parse(raw));
    expect(await readdir(dir)).toEqual(["tasks.json"]);
  });

  it("creates the support directory if it doesn't exist yet", async () => {
    const nestedDir = join(dir, "does", "not", "exist", "yet");
    environment.supportPath = nestedDir;

    await writeJsonFile("tasks.json", [{ id: "1" }]);
    const result = await readJsonFile("tasks.json", []);

    expect(result).toEqual([{ id: "1" }]);
  });
});

describe("updateJsonFile", () => {
  it("keeps every change when updates overlap", async () => {
    // Each update yields mid-way, the way an awaited local read would, so without the lock
    // they'd all read the same empty list and only the last append would survive.
    const append = (id: string) =>
      updateJsonFile<{ id: string }[]>("tasks.json", [], async (current) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return [...current, { id }];
      });

    await Promise.all([append("a"), append("b"), append("c")]);

    const result = await readJsonFile<{ id: string }[]>("tasks.json", []);
    expect(result.map((t) => t.id).sort()).toEqual(["a", "b", "c"]);
    expect(await readdir(dir)).toEqual(["tasks.json"]);
  });

  it("returns what it replaced and what it wrote", async () => {
    await writeJsonFile("tasks.json", [{ id: "1" }]);

    const result = await updateJsonFile<{ id: string }[]>("tasks.json", [], (current) => [...current, { id: "2" }]);

    expect(result).toEqual({ previous: [{ id: "1" }], next: [{ id: "1" }, { id: "2" }] });
  });

  it("doesn't write when the update hands back the current value", async () => {
    await updateJsonFile("tasks.json", [], (current) => current);

    expect(await readdir(dir)).toEqual([]);
  });

  it("releases the lock when the update throws", async () => {
    await expect(
      updateJsonFile("tasks.json", [], () => {
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");

    await updateJsonFile("tasks.json", [], () => [{ id: "after" }]);
    expect(await readJsonFile("tasks.json", [])).toEqual([{ id: "after" }]);
  });

  it("takes over a lock left behind by a process that died holding it", async () => {
    const lockPath = join(dir, "tasks.json.lock");
    await mkdir(lockPath);
    const longAgo = new Date(Date.now() - 60_000);
    await utimes(lockPath, longAgo, longAgo);

    await updateJsonFile("tasks.json", [], () => [{ id: "1" }]);

    expect(await readJsonFile("tasks.json", [])).toEqual([{ id: "1" }]);
  });
});
