import { useCallback, useEffect, useRef, useState } from "react";
import type { ScheduledTask, ScheduledTaskRun } from "@pi-desktop/shared";
import { api } from "../../lib/api";

/** Mounted only while shortcuts are enabled; the Host still owns execution. */
export function useSidebarScheduledTasks() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [runs, setRuns] = useState<ScheduledTaskRun[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const revision = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++revision.current;
    try {
      const [taskResult, runResult] = await Promise.all([
        api.listScheduled(),
        api.listScheduledRuns({ latestPerTask: true }),
      ]);
      if (!mounted.current || request !== revision.current) return;
      setTasks(taskResult.tasks);
      setRuns(runResult.runs);
      setLoaded(true);
      setError("");
    } catch (failure) {
      if (mounted.current && request === revision.current) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    // Match the Scheduled page, including task edits made in other windows.
    const timer = setInterval(() => void refresh(), 10_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      mounted.current = false;
      revision.current++;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return { tasks, runs, loaded, error, refresh };
}
