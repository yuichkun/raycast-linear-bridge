import { environment, LocalStorage } from "@raycast/api";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dequeue,
  enqueueArchive,
  enqueueComment,
  enqueueCreate,
  enqueueFieldUpdate,
  getPendingOpsForIssue,
  getQueue,
} from "./syncQueue";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "linear-bridge-test-"));
  environment.supportPath = dir;
  vi.mocked(LocalStorage.getItem).mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("sync queue (moved to environment.supportPath)", () => {
  it("returns an empty queue on a fresh install", async () => {
    expect(await getQueue()).toEqual([]);
  });

  it("enqueues and persists a field update op", async () => {
    await enqueueFieldUpdate("issue-1", "title", "New title", "Old title");

    const queue = await getQueue();

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      type: "updateField",
      issueId: "issue-1",
      field: "title",
      value: "New title",
      previousValue: "Old title",
    });
  });

  it("enqueues archive and create ops", async () => {
    await enqueueArchive("issue-1");
    await enqueueCreate("temp-1", { teamId: "team-1", title: "New task" });

    const queue = await getQueue();

    expect(queue.map((op) => op.type)).toEqual(["archive", "create"]);
  });

  it("enqueues a comment op carrying the body", async () => {
    await enqueueComment("issue-1", "Looks done to me");

    const [op] = await getQueue();

    expect(op).toMatchObject({ type: "createComment", issueId: "issue-1", body: "Looks done to me" });
  });

  it("dequeues an op by id, leaving the rest", async () => {
    await enqueueFieldUpdate("issue-1", "title", "A", "B");
    await enqueueFieldUpdate("issue-2", "title", "C", "D");
    const [first] = await getQueue();

    await dequeue(first.opId);

    const remaining = await getQueue();
    expect(remaining.map((op) => op.issueId)).toEqual(["issue-2"]);
  });

  it("filters pending ops for a specific issue", async () => {
    await enqueueFieldUpdate("issue-1", "title", "A", "B");
    await enqueueFieldUpdate("issue-2", "title", "C", "D");
    await enqueueArchive("issue-1");

    const result = await getPendingOpsForIssue("issue-1");

    expect(result).toHaveLength(2);
    expect(result.every((op) => op.issueId === "issue-1")).toBe(true);
  });

  it("migrates an existing install's queue from the legacy LocalStorage key", async () => {
    const legacyQueue = [{ opId: "op-1", type: "archive", issueId: "issue-1", createdAt: "2026-01-01T00:00:00.000Z" }];
    vi.mocked(LocalStorage.getItem).mockImplementation(async (key: string) =>
      key === "syncQueue" ? JSON.stringify(legacyQueue) : undefined,
    );

    const result = await getQueue();

    expect(result).toEqual(legacyQueue);
  });
});
