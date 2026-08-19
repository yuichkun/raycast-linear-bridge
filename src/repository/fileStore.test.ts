import { environment, LocalStorage } from "@raycast/api";
import { mkdtemp, readdir, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readJsonFile, writeJsonFile } from "./fileStore";

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

  it("creates the support directory if it doesn't exist yet", async () => {
    const nestedDir = join(dir, "does", "not", "exist", "yet");
    environment.supportPath = nestedDir;

    await writeJsonFile("tasks.json", [{ id: "1" }]);
    const result = await readJsonFile("tasks.json", []);

    expect(result).toEqual([{ id: "1" }]);
  });
});
