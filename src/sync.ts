import { showToast, Toast } from "@raycast/api";
import { runSync } from "./sync/runSync";

export default async function Command() {
  try {
    const { queueResult } = await runSync();

    if (queueResult.networkUnreachable) {
      await showToast({ style: Toast.Style.Failure, title: "Sync failed", message: "No network connection" });
      return;
    }

    if (queueResult.failures.length > 0) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Sync completed with errors",
        message: `${queueResult.failures.length} change(s) rejected by Linear`,
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
