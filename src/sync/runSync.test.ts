import { beforeEach, describe, expect, it, vi } from "vitest";
import { refreshItemsFromLinear, retrieveCachedItems } from "../storage";
import { Task } from "../types";
import { processQueue } from "./processQueue";
import { runSync } from "./runSync";

vi.mock("../storage", () => ({
  refreshItemsFromLinear: vi.fn(),
  retrieveCachedItems: vi.fn(),
}));

vi.mock("./processQueue", () => ({
  processQueue: vi.fn(),
}));

function task(id: string): Task {
  return {
    id,
    syncState: "synced",
    title: `Task ${id}`,
    priority: 0,
    labelIds: [],
    labelNames: [],
    archivedLocally: false,
  };
}

const fresh = [task("fresh")];
const cached = [task("cached")];

beforeEach(() => {
  vi.mocked(processQueue).mockReset().mockResolvedValue({ networkUnreachable: false, failures: [] });
  vi.mocked(refreshItemsFromLinear).mockReset().mockResolvedValue(fresh);
  vi.mocked(retrieveCachedItems).mockReset().mockResolvedValue(cached);
});

describe("runSync", () => {
  it("returns the pulled tasks when Linear is reachable", async () => {
    const result = await runSync();

    expect(result.tasks).toBe(fresh);
    expect(result.networkUnreachable).toBe(false);
  });

  it("pushes before it pulls", async () => {
    const order: string[] = [];
    vi.mocked(processQueue).mockImplementation(async () => {
      order.push("push");
      return { networkUnreachable: false, failures: [] };
    });
    vi.mocked(refreshItemsFromLinear).mockImplementation(async () => {
      order.push("pull");
      return fresh;
    });

    await runSync();

    expect(order).toEqual(["push", "pull"]);
  });

  // The message Raycast's error overlay showed for this: the SDK wraps fetch's
  // "fetch failed" TypeError in a LinearError, which capitalises it.
  it("falls back to the cache instead of throwing when the pull can't reach Linear", async () => {
    vi.mocked(refreshItemsFromLinear).mockRejectedValue(new Error("Fetch failed"));

    const result = await runSync();

    expect(result.tasks).toBe(cached);
    expect(result.networkUnreachable).toBe(true);
  });

  it("reports unreachable when the push couldn't reach Linear even if the pull then could", async () => {
    vi.mocked(processQueue).mockResolvedValue({ networkUnreachable: true, failures: [] });

    const result = await runSync();

    expect(result.tasks).toBe(fresh);
    expect(result.networkUnreachable).toBe(true);
  });

  it("still throws when Linear answered and said no", async () => {
    vi.mocked(refreshItemsFromLinear).mockRejectedValue(new Error("Authentication error"));

    await expect(runSync()).rejects.toThrow("Authentication error");
  });
});
