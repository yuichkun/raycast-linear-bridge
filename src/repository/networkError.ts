// Distinguishes "Linear couldn't be reached" from "Linear answered and said no". The
// former leaves a queued op in place for the next attempt; the latter rolls it back.
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("enotfound") ||
    message.includes("econnrefused") ||
    message.includes("timeout") ||
    message.includes("timed out")
  );
}
