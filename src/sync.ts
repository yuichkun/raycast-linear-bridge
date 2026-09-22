import { showToast, Toast } from "@raycast/api";
import { CreateCommentOp } from "./repository/syncQueue";
import { runSync } from "./sync/runSync";

export default async function Command() {
  try {
    const { networkUnreachable, queueResult } = await runSync();

    if (networkUnreachable) {
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

    await showToast({ style: Toast.Style.Success, title: "Synced with Linear" });
  } catch (e) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Sync failed",
      message: e instanceof Error ? e.message : undefined,
    });
  }
}
