import { environment } from "@raycast/api";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getVisibleTeamIds, setVisibleTeamIds } from "./settings";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "linear-bridge-test-"));
  environment.supportPath = dir;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("visible team ids", () => {
  it("returns an empty selection before anything is saved", async () => {
    expect(await getVisibleTeamIds()).toEqual([]);
  });

  it("round-trips the selected team ids", async () => {
    await setVisibleTeamIds(["team-a", "team-b"]);

    expect(await getVisibleTeamIds()).toEqual(["team-a", "team-b"]);
  });

  it("clears the filter when saving an empty selection", async () => {
    await setVisibleTeamIds(["team-a"]);
    await setVisibleTeamIds([]);

    expect(await getVisibleTeamIds()).toEqual([]);
  });
});
