import { vi } from "vitest";

// vi.fn()-based (not plain async functions) so tests can control return values per case
// via vi.mocked(LocalStorage.getItem).mockResolvedValueOnce(...) — needed by
// fileStore.test.ts to simulate the presence/absence of legacy LocalStorage data during
// migration.
export const LocalStorage = {
  getItem: vi.fn(async () => undefined),
  setItem: vi.fn(async () => undefined),
  allItems: vi.fn(async () => ({})),
};

// Generic proxy rather than an enumerated list: constants.ts references Icon/Color members
// as values (not just types) at module load time, so anything importing it transitively
// (e.g. search.ts, for PRIORITY_NAMES) needs these defined here or the import crashes in
// tests. The actual string values don't matter for test assertions.
export const Icon = new Proxy({}, { get: (_target, prop) => String(prop) }) as Record<string, string>;
export const Color = new Proxy({}, { get: (_target, prop) => String(prop) }) as Record<string, string>;

// Mutable on purpose: tests that exercise fileStore.ts point this at a real temporary
// directory per-test (via beforeEach), so file I/O in tests hits real disk, not a mock.
export const environment = { supportPath: "" };
