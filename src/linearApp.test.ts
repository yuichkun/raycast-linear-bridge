import { describe, expect, it, vi } from "vitest";
import {
  findLinearAppByBundleId,
  findLinearAppOnWindows,
  locateLinearApp,
  LocateLinearAppDeps,
  toLinearDeepLink,
} from "./linearApp";

const chrome = { name: "Google Chrome", path: "/Applications/Google Chrome.app", bundleId: "com.google.Chrome" };
const linear = { name: "Linear", path: "/Applications/Linear.app", bundleId: "com.linear" };
const HOME = "/Users/me";

// Windows fixtures. The App ID values are representative of the two shapes Windows uses,
// not values read off a real install — Linear does not publish its App ID, which is why
// findLinearAppOnWindows matches a segment rather than one exact string.
const edge = { name: "Microsoft Edge", path: "C:/Program Files/Microsoft/Edge/edge.exe", windowsAppId: "MSEdge" };
const linearWin = {
  name: "Linear",
  path: "C:/Users/me/AppData/Local/Programs/Linear/Linear.exe",
  windowsAppId: "com.squirrel.Linear.Linear",
};

describe("findLinearAppByBundleId", () => {
  it("finds the desktop app by its bundle id", () => {
    expect(findLinearAppByBundleId([chrome, linear])).toBe(linear);
  });

  it("matches on bundle id even when the app is named differently", () => {
    const renamed = { ...linear, name: "Linear Beta" };
    expect(findLinearAppByBundleId([chrome, renamed])).toBe(renamed);
  });

  it("ignores an app that is merely named Linear", () => {
    const impostor = { name: "Linear", path: "/Applications/Other.app", bundleId: "com.example.lookalike" };
    expect(findLinearAppByBundleId([chrome, impostor])).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(findLinearAppByBundleId([])).toBeNull();
  });
});

describe("findLinearAppOnWindows", () => {
  it("finds the desktop app by a Windows App ID segment", () => {
    expect(findLinearAppOnWindows([edge, linearWin])).toBe(linearWin);
  });

  it("matches a packaged App ID too", () => {
    const packaged = { ...linearWin, name: "Linear Desktop", windowsAppId: "Linear_8wekyb3d8bbwe!App" };
    expect(findLinearAppOnWindows([edge, packaged])).toBe(packaged);
  });

  it("falls back to the display name when there is no App ID", () => {
    const noAppId = { name: "Linear", path: "C:/Apps/Linear/Linear.exe" };
    expect(findLinearAppOnWindows([edge, noAppId])).toBe(noAppId);
  });

  // The macOS path can afford an exact bundle id; Windows cannot, so the segment match is
  // the thing keeping a same-prefixed product from being picked up by mistake.
  it("ignores a product whose name merely starts with Linear", () => {
    const curve = { name: "Linearity Curve", path: "C:/Apps/Curve.exe", windowsAppId: "com.linearity.curve" };
    expect(findLinearAppOnWindows([edge, curve])).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(findLinearAppOnWindows([])).toBeNull();
  });
});

describe("locateLinearApp", () => {
  // Mimics the observed Raycast behaviour: the unscoped list omits Linear.app, while asking
  // for the apps that can open the bundle path includes it.
  function deps(overrides: Partial<LocateLinearAppDeps> = {}): LocateLinearAppDeps {
    return {
      platform: "darwin",
      homeDir: HOME,
      exists: (path) => path === "/Applications/Linear.app",
      getApplications: vi.fn(async (path?: string) =>
        path === "/Applications/Linear.app"
          ? [linear, { name: "TextEdit", path: "/System/Applications/TextEdit.app" }]
          : [chrome],
      ),
      ...overrides,
    };
  }

  it("uses the unscoped list on Windows, without probing any path", async () => {
    const d = deps({
      platform: "win32",
      exists: () => {
        throw new Error("Windows must not probe install paths");
      },
      getApplications: vi.fn(async () => [edge, linearWin]),
    });
    expect(await locateLinearApp(d)).toBe(linearWin);
    expect(d.getApplications).toHaveBeenCalledTimes(1);
    expect(d.getApplications).toHaveBeenCalledWith();
  });

  it("returns null on Windows when the app is not installed", async () => {
    const d = deps({ platform: "win32", getApplications: vi.fn(async () => [edge]) });
    expect(await locateLinearApp(d)).toBeNull();
  });

  it("returns null on a platform that is neither macOS nor Windows", async () => {
    const d = deps({ platform: "linux" });
    expect(await locateLinearApp(d)).toBeNull();
    expect(d.getApplications).not.toHaveBeenCalled();
  });

  it("finds the app through its bundle path even when the unscoped list omits it", async () => {
    const d = deps();
    expect(await locateLinearApp(d)).toBe(linear);
    expect(d.getApplications).toHaveBeenCalledTimes(1);
    expect(d.getApplications).toHaveBeenCalledWith("/Applications/Linear.app");
  });

  it("probes the per-user Applications folder too", async () => {
    const userPath = `${HOME}/Applications/Linear.app`;
    const d = deps({
      exists: (path) => path === userPath,
      getApplications: vi.fn(async (path?: string) => (path === userPath ? [linear] : [])),
    });
    expect(await locateLinearApp(d)).toBe(linear);
    expect(d.getApplications).toHaveBeenCalledWith(userPath);
  });

  it("falls back to the unscoped list when no known path exists", async () => {
    const d = deps({ exists: () => false, getApplications: vi.fn(async () => [chrome, linear]) });
    expect(await locateLinearApp(d)).toBe(linear);
    expect(d.getApplications).toHaveBeenCalledTimes(1);
    expect(d.getApplications).toHaveBeenCalledWith();
  });

  it("falls back to the unscoped list when the path lookup doesn't contain Linear", async () => {
    const d = deps({ getApplications: vi.fn(async (path?: string) => (path ? [chrome] : [linear])) });
    expect(await locateLinearApp(d)).toBe(linear);
    expect(d.getApplications).toHaveBeenCalledTimes(2);
  });

  it("returns null when the app is nowhere to be found", async () => {
    const d = deps({ exists: () => false, getApplications: vi.fn(async () => [chrome]) });
    expect(await locateLinearApp(d)).toBeNull();
  });
});

describe("toLinearDeepLink", () => {
  it("swaps the https scheme for linear:// and keeps the rest of the URL", () => {
    expect(toLinearDeepLink("https://linear.app/acme/issue/ENG-123/some-title")).toBe(
      "linear://linear.app/acme/issue/ENG-123/some-title",
    );
  });

  it("keeps non-ASCII path segments as they are", () => {
    expect(toLinearDeepLink("https://linear.app/acme/issue/GEN-1/地方税納付")).toBe(
      "linear://linear.app/acme/issue/GEN-1/地方税納付",
    );
  });

  it("leaves a URL that isn't https untouched", () => {
    expect(toLinearDeepLink("linear://linear.app/acme/issue/ENG-123")).toBe("linear://linear.app/acme/issue/ENG-123");
  });
});
