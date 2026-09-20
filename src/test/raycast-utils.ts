import { vi } from "vitest";

// Mirrors src/test/raycast-api.ts: @raycast/utils reaches into the Raycast runtime, so
// importing the real module from a test would pull in the native side. sound.ts is the
// only module under test that touches it, and only for runPowerShellScript.
export const runPowerShellScript = vi.fn(async () => "");
