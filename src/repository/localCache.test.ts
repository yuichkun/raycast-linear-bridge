import { environment, LocalStorage } from "@raycast/api";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCachedTasks,
  getCachedTeamLabels,
  getCachedTeams,
  setCachedTeamLabels,
  setCachedTeams,
  setCachedTeamStates,
  updateCachedTasks,
} from "./localCache";
import { Task } from "../types";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "linear-bridge-test-"));
  environment.supportPath = dir;
  vi.mocked(LocalStorage.getItem).mockReset().mockResolvedValue(undefined);
  vi.mocked(LocalStorage.setItem).mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function task(id: string): Task {
  return {
    id,
    syncState: "local",
    title: id,
    priority: 0,
    labelIds: [],
    labelNames: [],
    archivedLocally: false,
  };
}

describe("tasks cache (moved to environment.supportPath)", () => {
  it("round-trips tasks through the file store", async () => {
    await updateCachedTasks(() => [task("a"), task("b")]);

    const result = await getCachedTasks();

    expect(result.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("returns an empty array on a fresh install with nothing in the file or LocalStorage", async () => {
    const result = await getCachedTasks();

    expect(result).toEqual([]);
  });

  it("migrates an existing install's tasks from the legacy LocalStorage key", async () => {
    const legacyTasks = [task("existing-local-only-task")];
    vi.mocked(LocalStorage.getItem).mockImplementation(async (key: string) =>
      key === "tasks" ? JSON.stringify(legacyTasks) : undefined,
    );

    const result = await getCachedTasks();

    expect(result.map((t) => t.id)).toEqual(["existing-local-only-task"]);
  });
});

describe("teamLabels/teamStates/teams caches (stay on LocalStorage)", () => {
  it("getCachedTeamLabels/setCachedTeamLabels still go through LocalStorage.getItem/setItem", async () => {
    await setCachedTeamLabels(new Map([["team-1", [{ id: "l1", name: "Bug" }]]]));

    expect(LocalStorage.setItem).toHaveBeenCalledWith("teamLabels", expect.any(String));

    vi.mocked(LocalStorage.getItem).mockResolvedValue(JSON.stringify([["team-1", [{ id: "l1", name: "Bug" }]]]));
    const result = await getCachedTeamLabels();
    expect(result.get("team-1")).toEqual([{ id: "l1", name: "Bug" }]);
  });

  it("getCachedTeamStates/setCachedTeamStates still go through LocalStorage.getItem/setItem", async () => {
    await setCachedTeamStates(new Map([["team-1", [{ id: "s1", name: "Todo", type: "unstarted", position: 0 }]]]));

    expect(LocalStorage.setItem).toHaveBeenCalledWith("teamStates", expect.any(String));
  });

  it("getCachedTeams/setCachedTeams still go through LocalStorage.getItem/setItem", async () => {
    await setCachedTeams([{ id: "team-1", name: "General" }]);

    expect(LocalStorage.setItem).toHaveBeenCalledWith("teams", expect.any(String));

    vi.mocked(LocalStorage.getItem).mockResolvedValue(JSON.stringify([{ id: "team-1", name: "General" }]));
    const result = await getCachedTeams();
    expect(result).toEqual([{ id: "team-1", name: "General" }]);
  });
});
