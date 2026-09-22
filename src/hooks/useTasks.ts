import { showFailureToast } from "@raycast/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { retrieveCachedItems } from "../storage";
import { runSync } from "../sync/runSync";
import { Task } from "../types";

const NOTHING_CACHED = "Couldn't reach Linear, and nothing is cached yet.";

// Stale-while-revalidate over the tasks cache. Every revalidation shows what's on disk
// first — which already includes the change that triggered it, since mutations write to
// the cache before calling back — and then applies what the sync returns, so the list
// converges on Linear's state without waiting for the next launch.
//
// Not @raycast/utils' useCachedPromise: that keeps its copy in Raycast's Cache, which
// "Clear Local Storage & Cache" wipes, and the tasks cache is the only copy of local-only
// tasks (see repository/localCache.ts). The disk cache is the source of truth here; this
// hook only mirrors it into React state.
export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();
  // Only the latest revalidation may write state. Two can overlap (Mark as Complete twice
  // in a row), and without this the older pull could land last and show a state that no
  // longer includes the second change.
  const latestCallId = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

  const revalidate = useCallback(async () => {
    const callId = ++latestCallId.current;
    const isCurrent = () => mounted.current && callId === latestCallId.current;

    const cached = await retrieveCachedItems();
    if (!isCurrent()) return;
    setTasks(cached);
    if (cached.length > 0) setIsLoading(false);

    try {
      const result = await runSync();
      if (!isCurrent()) return;
      setTasks(result.tasks);
      // Offline with nothing cached is the one case where there's nothing to show.
      setError(result.networkUnreachable && result.tasks.length === 0 ? NOTHING_CACHED : undefined);
    } catch (e) {
      if (!isCurrent()) return;
      // Linear answered and said no, or the cache couldn't be read. With tasks on screen
      // a toast is enough; with none, the message is all there is to show.
      if (cached.length > 0) {
        await showFailureToast(e, { title: "Couldn't refresh from Linear" });
      } else {
        setError(e instanceof Error ? e.message : "Failed to fetch issues from Linear");
      }
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    revalidate();
  }, [revalidate]);

  return { tasks, isLoading, error, revalidate };
}
