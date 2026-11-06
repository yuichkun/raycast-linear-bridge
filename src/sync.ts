import { environment, LaunchType, showToast, Toast } from "@raycast/api";
import { CreateCommentOp } from "./repository/syncQueue";
import { runSync } from "./sync/runSync";

export default async function Command() {
  // A scheduled run has nobody watching it: showToast falls back to a HUD when the Raycast
  // window is closed, so the routine outcomes — synced, or offline and will retry — would
  // pop up over whatever the user is doing, every interval. Rejected changes are different:
  // they've been rolled back and this is the only time they'll be reported.
  const quiet = environment.launchType === LaunchType.Background;

  try {
    const { networkUnreachable, queueResult } = await runSync();

    if (networkUnreachable) {
      if (!quiet)
        await showToast({ style: Toast.Style.Failure, title: "Sync failed", message: "No network connection" });
      return;
    }

    if (queueResult.failures.length > 0) {
      // A rejected comment has no local copy to fall back on (nothing was written to the
      // cache for it), so its text goes into the toast rather than vanishing silently.
      const rejectedComment = queueResult.failures.find((op): op is CreateCommentOp => op.type === "createComment");
      const summary = `${queueResult.failures.length} change(s) rejected by Linear`;
      await showToast({
        style: Toast.Style.Failure,
        title: "Sync completed with errors",
        message: rejectedComment ? `${summary}, including a comment: "${rejectedComment.body}"` : summary,
      });
      return;
    }

    // Still queued, nothing rolled back — so, like being offline, only worth saying when
    // someone ran Sync to find out.
    if (queueResult.deferred > 0) {
      if (!quiet)
        await showToast({
          style: Toast.Style.Failure,
          title: "Some changes are still waiting",
          message: `Linear couldn't take ${queueResult.deferred} change(s) right now — they'll be sent on the next sync`,
        });
      return;
    }

    if (!quiet) await showToast({ style: Toast.Style.Success, title: "Synced with Linear" });
  } catch (e) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Sync failed",
      message: e instanceof Error ? e.message : undefined,
    });
  }
}
