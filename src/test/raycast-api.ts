export const LocalStorage = {
  getItem: async () => undefined,
  setItem: async () => undefined,
  allItems: async () => ({}),
};

// Generic proxy rather than an enumerated list: constants.ts references Icon/Color members
// as values (not just types) at module load time, so anything importing it transitively
// (e.g. search.ts, for PRIORITY_NAMES) needs these defined here or the import crashes in
// tests. The actual string values don't matter for test assertions.
export const Icon = new Proxy({}, { get: (_target, prop) => String(prop) }) as Record<string, string>;
export const Color = new Proxy({}, { get: (_target, prop) => String(prop) }) as Record<string, string>;
