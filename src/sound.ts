import { runPowerShellScript } from "@raycast/utils";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Escapes a path for a PowerShell single-quoted string, where the only special character
// is the quote itself and it is escaped by doubling.
export function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

// MediaPlayer opens media asynchronously: NaturalDuration stays Automatic until the file
// is loaded, so reading its TimeSpan right after Open() throws. Poll until it is there,
// then sleep for the clip's length — powershell exiting early cuts the sound off.
//
// The fallback sleep covers the case where the duration never resolves: better a fixed
// couple of seconds than either a silent clip or a hang. Everything stays well inside
// runPowerShellScript's 10s default timeout.
export function windowsPlaybackScript(filePath: string): string {
  const quoted = `'${escapePowerShellSingleQuoted(filePath)}'`;
  return `
Add-Type -AssemblyName presentationCore
$player = New-Object System.Windows.Media.MediaPlayer
$player.Open([System.Uri]${quoted})
$deadline = (Get-Date).AddSeconds(5)
while (-not $player.NaturalDuration.HasTimeSpan -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 50 }
$player.Volume = 1
$player.Play()
if ($player.NaturalDuration.HasTimeSpan) {
  Start-Sleep -Milliseconds $player.NaturalDuration.TimeSpan.TotalMilliseconds
} else {
  Start-Sleep -Seconds 2
}
$player.Close()
`.trim();
}

// Plays a bundled notification sound. Never throws.
//
// This used to go through sound-play, whose Windows branch shells out to a powershell
// one-liner that reads NaturalDuration immediately after Open() — so on Windows it threw
// rather than played. Because the only caller awaits it inside the try block that marks a
// task complete, that turned a working completion into a "Failed to complete task" toast.
// A notification sound is feedback about an operation, not the operation, so a failure
// here is logged and swallowed.
export async function playSound(fileName: "todo.mp3"): Promise<void> {
  const filePath = join(__dirname, `./assets/${fileName}`);
  try {
    if (process.platform === "win32") {
      await runPowerShellScript(windowsPlaybackScript(filePath));
      return;
    }
    // -v 2 matches what sound-play passed on macOS (it doubled the 0..1 volume it was
    // given), so the clip stays as loud as it has always been.
    await execFileAsync("afplay", [filePath, "-v", "2"]);
  } catch (error) {
    console.error(`Failed to play ${fileName}`, error);
  }
}
