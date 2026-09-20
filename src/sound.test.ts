import { describe, expect, it } from "vitest";
import { escapePowerShellSingleQuoted, windowsPlaybackScript } from "./sound";

describe("escapePowerShellSingleQuoted", () => {
  it("leaves an ordinary Windows path alone", () => {
    expect(escapePowerShellSingleQuoted("C:\\Users\\me\\assets\\todo.mp3")).toBe("C:\\Users\\me\\assets\\todo.mp3");
  });

  // A quote in a Windows user name is unusual but legal, and it would otherwise close the
  // string literal the path is interpolated into.
  it("doubles a single quote", () => {
    expect(escapePowerShellSingleQuoted("C:\\Users\\O'Brien\\todo.mp3")).toBe("C:\\Users\\O''Brien\\todo.mp3");
  });

  it("leaves backslashes as they are, since single-quoted strings do not escape them", () => {
    expect(escapePowerShellSingleQuoted("C:\\a\\b")).toBe("C:\\a\\b");
  });
});

describe("windowsPlaybackScript", () => {
  const script = windowsPlaybackScript("C:\\Users\\me\\assets\\todo.mp3");

  it("opens the file as an absolute Uri rather than a bare string", () => {
    expect(script).toContain("$player.Open([System.Uri]'C:\\Users\\me\\assets\\todo.mp3')");
  });

  // The bug being fixed: sound-play read TimeSpan straight after Open(), while
  // NaturalDuration is still Automatic, and threw.
  it("waits for NaturalDuration before reading its TimeSpan", () => {
    const wait = script.indexOf("$player.NaturalDuration.HasTimeSpan");
    const read = script.indexOf("$player.NaturalDuration.TimeSpan");
    expect(wait).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(wait);
  });

  it("keeps playing until the clip ends, with a bounded fallback", () => {
    expect(script).toContain("Start-Sleep -Milliseconds $player.NaturalDuration.TimeSpan.TotalMilliseconds");
    expect(script).toContain("Start-Sleep -Seconds 2");
  });

  it("escapes a quote in the path", () => {
    expect(windowsPlaybackScript("C:\\Users\\O'Brien\\todo.mp3")).toContain(
      "[System.Uri]'C:\\Users\\O''Brien\\todo.mp3'",
    );
  });
});
