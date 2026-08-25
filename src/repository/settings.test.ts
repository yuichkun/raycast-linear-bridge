import { environment } from "@raycast/api";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDueHorizon, getVisibleTeamIds, setDueHorizon, setVisibleTeamIds } from "./settings";

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

describe("due horizon", () => {
  it("defaults to all before anything is saved", async () => {
    expect(await getDueHorizon()).toBe("all");
  });

  it("round-trips the chosen horizon", async () => {
    await setDueHorizon("week");

    expect(await getDueHorizon()).toBe("week");
  });

  it("falls back to all when the stored value is unrecognized", async () => {
    await writeFile(join(dir, "settings.json"), JSON.stringify({ visibleTeamIds: [], dueHorizon: "fortnight" }));

    expect(await getDueHorizon()).toBe("all");
  });
});

describe("settings file", () => {
  it("keeps the other setting intact when one is saved", async () => {
    await setVisibleTeamIds(["team-a"]);
    await setDueHorizon("month");

    expect(await getVisibleTeamIds()).toEqual(["team-a"]);
    expect(await getDueHorizon()).toBe("month");
  });
});
