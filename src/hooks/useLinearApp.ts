import { Application, getApplications } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { locateLinearApp } from "../linearApp";

// One lookup per process: every TaskEditMenu instance (one per list row) awaits this same
// promise instead of firing its own lookup on mount.
let linearAppPromise: Promise<Application | null> | undefined;

function loadLinearApp(): Promise<Application | null> {
  if (!linearAppPromise) {
    linearAppPromise = locateLinearApp({
      platform: process.platform,
      homeDir: homedir(),
      exists: existsSync,
      getApplications,
    }).catch(() => {
      // Best-effort detection: a failed lookup means "use the browser", not an error
      // toast, and the next mount retries.
      linearAppPromise = undefined;
      return null;
    });
  }
  return linearAppPromise;
}

// Whether the Linear desktop app is installed — not whether it's running. Raycast's API
// has no way to ask the latter, and opening a URL in an installed-but-closed app launches
// it, which is the wanted outcome anyway. useCachedPromise keeps the result across
// launches: the very first launch renders Open in Browser until the lookup resolves,
// every later launch renders Open in Linear from the first paint.
export function useLinearApp(): Application | null {
  const { data } = useCachedPromise(loadLinearApp, []);
  return data ?? null;
}
