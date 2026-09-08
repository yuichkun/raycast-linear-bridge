import { describe, expect, it, vi } from "vitest";
import { findLinearApp, locateLinearApp, LocateLinearAppDeps, toLinearDeepLink } from "./linearApp";

const chrome = { name: "Google Chrome", path: "/Applications/Google Chrome.app", bundleId: "com.google.Chrome" };
const linear = { name: "Linear", path: "/Applications/Linear.app", bundleId: "com.linear" };
const HOME = "/Users/me";

describe("findLinearApp", () => {
  it("finds the desktop app by its bundle id", () => {
    expect(findLinearApp([chrome, linear])).toBe(linear);
  });

  it("matches on bundle id even when the app is named differently", () => {
    const renamed = { ...linear, name: "Linear Beta" };
    expect(findLinearApp([chrome, renamed])).toBe(renamed);
  });

  it("ignores an app that is merely named Linear", () => {
    const impostor = { name: "Linear", path: "/Applications/Other.app", bundleId: "com.example.lookalike" };
    expect(findLinearApp([chrome, impostor])).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(findLinearApp([])).toBeNull();
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

  it("returns null on Windows without looking anything up", async () => {
    const d = deps({ platform: "win32" });
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
