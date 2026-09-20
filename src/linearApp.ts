import type { Application } from "@raycast/api";
import { join } from "node:path";

// The desktop app's macOS bundle identifier, as declared in Linear.app's Info.plist — the
// same key Raycast's official Linear extension checks.
export const LINEAR_BUNDLE_ID = "com.linear";

// The app's display name. Only used on Windows — the macOS path has the bundle id and
// doesn't need to fall back to a name.
export const LINEAR_APP_NAME = "Linear";

// Standard install locations of the macOS bundle: drag-to-Applications and Homebrew both
// land in /Applications; ~/Applications is the per-user variant.
export function macosBundlePaths(homeDir: string): string[] {
  return ["/Applications/Linear.app", join(homeDir, "Applications", "Linear.app")];
}

// Picks the Linear desktop app out of an installed-applications list by bundle id. Null
// rather than undefined when absent, so the result stays JSON-serialisable for the cache.
export function findLinearAppByBundleId(applications: Application[]): Application | null {
  return applications.find((app) => app.bundleId === LINEAR_BUNDLE_ID) ?? null;
}

// Windows has no counterpart to the bundle id that we can name with the same confidence.
// Raycast reports a `windowsAppId`, but Linear's value isn't published anywhere and the
// official Linear extension doesn't check one either, so this matches the two fields
// Raycast does give us: the Windows App ID, which embeds the product name, and the
// display name.
//
// Deliberately looser than the macOS rule. A false positive opens the wrong app, which the
// user sees straight away and can report; a false negative silently drops the feature back
// to the browser, which is the bug this is fixing.
export function findLinearAppOnWindows(applications: Application[]): Application | null {
  return applications.find((app) => app.name === LINEAR_APP_NAME || hasLinearAppIdSegment(app.windowsAppId)) ?? null;
}

// A Windows App ID is a segmented identifier — `com.squirrel.Linear.Linear` for a Squirrel
// install, `<PackageFamilyName>!App` for a packaged one. Matching a whole segment rather
// than a substring keeps unrelated products whose name merely starts with "linear", such as
// Linearity Curve, from being taken for the Linear desktop app.
function hasLinearAppIdSegment(windowsAppId: string | undefined): boolean {
  if (!windowsAppId) return false;
  return windowsAppId
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .includes(LINEAR_APP_NAME.toLowerCase());
}

export type LocateLinearAppDeps = {
  platform: NodeJS.Platform;
  homeDir: string;
  exists: (path: string) => boolean;
  getApplications: (path?: string) => Promise<Application[]>;
};

// Finds the installed desktop app, or null when there isn't one — which means "use the
// browser", not "something went wrong".
//
// macOS probes the known install paths first: Raycast's unscoped getApplications() is not
// a complete list — it can omit Linear.app even while Raycast's own root search lists it —
// whereas asking for the applications that can open the bundle path itself does include
// Linear. Windows goes straight to the unscoped enumeration instead: that gap is a macOS
// observation, we have no evidence it applies there, and guessing at Windows install paths
// without a machine to check them on would be inventing facts. Probing can be added if a
// Windows user reports the app going undetected.
export async function locateLinearApp(deps: LocateLinearAppDeps): Promise<Application | null> {
  if (deps.platform === "win32") {
    return findLinearAppOnWindows(await deps.getApplications());
  }
  if (deps.platform !== "darwin") return null;
  for (const bundlePath of macosBundlePaths(deps.homeDir)) {
    if (!deps.exists(bundlePath)) continue;
    const found = findLinearAppByBundleId(await deps.getApplications(bundlePath));
    if (found) return found;
  }
  return findLinearAppByBundleId(await deps.getApplications());
}

// Linear's documented desktop-app form of an issue URL: the `linear://` scheme followed by
// the rest of the https URL (e.g. linear://linear.app/acme/issue/ENG-123). Handing the
// desktop app the plain https URL doesn't work — it bounces the link back to the default
// browser — so this is the target the app has to be given.
export function toLinearDeepLink(url: string): string {
  return url.replace(/^https:\/\//, "linear://");
}
