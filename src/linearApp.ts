import type { Application } from "@raycast/api";
import { join } from "node:path";

// The desktop app's macOS bundle identifier, as declared in Linear.app's Info.plist — the
// same key Raycast's official Linear extension checks.
export const LINEAR_BUNDLE_ID = "com.linear";

// Standard install locations of the macOS bundle: drag-to-Applications and Homebrew both
// land in /Applications; ~/Applications is the per-user variant.
export function macosBundlePaths(homeDir: string): string[] {
  return ["/Applications/Linear.app", join(homeDir, "Applications", "Linear.app")];
}

// Picks the Linear desktop app out of an installed-applications list by bundle id. Null
// rather than undefined when absent, so the result stays JSON-serialisable for the cache.
export function findLinearApp(applications: Application[]): Application | null {
  return applications.find((app) => app.bundleId === LINEAR_BUNDLE_ID) ?? null;
}

export type LocateLinearAppDeps = {
  platform: NodeJS.Platform;
  homeDir: string;
  exists: (path: string) => boolean;
  getApplications: (path?: string) => Promise<Application[]>;
};

// macOS only: there is no verified way to detect the app on Windows, nor to hand it an
// issue there, so Windows keeps the browser. Raycast's unscoped getApplications() is not
// a complete list — it can omit Linear.app even while Raycast's own root search lists it —
// whereas asking for the applications that can open the bundle path itself does include
// Linear. So the known install paths are probed first, and the unscoped enumeration (the
// check Raycast's official Linear extension relies on) is only the fallback.
export async function locateLinearApp(deps: LocateLinearAppDeps): Promise<Application | null> {
  if (deps.platform !== "darwin") return null;
  for (const bundlePath of macosBundlePaths(deps.homeDir)) {
    if (!deps.exists(bundlePath)) continue;
    const found = findLinearApp(await deps.getApplications(bundlePath));
    if (found) return found;
  }
  return findLinearApp(await deps.getApplications());
}

// Linear's documented desktop-app form of an issue URL: the `linear://` scheme followed by
// the rest of the https URL (e.g. linear://linear.app/acme/issue/ENG-123). Handing the
// desktop app the plain https URL doesn't work — it bounces the link back to the default
// browser — so this is the target the app has to be given.
export function toLinearDeepLink(url: string): string {
  return url.replace(/^https:\/\//, "linear://");
}
