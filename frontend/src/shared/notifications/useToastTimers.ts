import { useCallback, useEffect, useMemo, useRef } from "react";
import { NOTIFICATION_EXIT_MS } from "./notifications";

interface ToastTimer {
  autoDismissId?: number;
  exitId?: number;
  remainingMs: number;
  /** Kept from the last `schedule`, so `resume` expires the toast the same way. */
  onExpire?: (id: string) => void;
  /** Absolute `performance.now()` deadline, or undefined while the pointer holds the toast. */
  deadlineMs?: number;
}

export interface ToastTimers {
  schedule: (id: string, durationMs: number, onExpire: (id: string) => void) => void;
  pause: (id: string) => void;
  resume: (id: string) => void;
  /** Arms the removal that follows the exit animation; false when one is already running. */
  armExit: (id: string, onRemove: (id: string) => void) => boolean;
  cancel: (id: string) => void;
}

export function useToastTimers(): ToastTimers {
  const timersRef = useRef(new Map<string, ToastTimer>());

  const clearAutoDismiss = useCallback((timer: ToastTimer) => {
    if (timer.autoDismissId !== undefined) {
      window.clearTimeout(timer.autoDismissId);
      timer.autoDismissId = undefined;
    }
    timer.deadlineMs = undefined;
  }, []);

  const schedule = useCallback(
    (id: string, durationMs: number, onExpire: (id: string) => void) => {
      const timer = timersRef.current.get(id) ?? { remainingMs: durationMs };
      timersRef.current.set(id, timer);
      clearAutoDismiss(timer);
      timer.onExpire = onExpire;

      const remainingMs = Math.max(0, durationMs);
      timer.remainingMs = remainingMs;

      if (remainingMs === 0) {
        onExpire(id);
        return;
      }

      timer.deadlineMs = performance.now() + remainingMs;
      timer.autoDismissId = window.setTimeout(() => {
        const current = timersRef.current.get(id);
        if (current) {
          current.autoDismissId = undefined;
          current.deadlineMs = undefined;
        }
        onExpire(id);
      }, remainingMs);
    },
    [clearAutoDismiss],
  );

  const pause = useCallback(
    (id: string) => {
      const timer = timersRef.current.get(id);
      if (!timer || timer.autoDismissId === undefined) return;

      const remainingMs =
        timer.deadlineMs === undefined ? timer.remainingMs : timer.deadlineMs - performance.now();

      clearAutoDismiss(timer);
      timer.remainingMs = Math.max(0, remainingMs);
    },
    [clearAutoDismiss],
  );

  const resume = useCallback(
    (id: string) => {
      const timer = timersRef.current.get(id);
      if (!timer?.onExpire || timer.autoDismissId !== undefined) return;

      schedule(id, timer.remainingMs, timer.onExpire);
    },
    [schedule],
  );

  const armExit = useCallback((id: string, onRemove: (id: string) => void) => {
    const timer = timersRef.current.get(id) ?? { remainingMs: 0 };
    timersRef.current.set(id, timer);

    if (timer.exitId !== undefined) return false;

    timer.exitId = window.setTimeout(() => onRemove(id), NOTIFICATION_EXIT_MS);
    return true;
  }, []);

  const cancel = useCallback(
    (id: string) => {
      const timer = timersRef.current.get(id);
      if (!timer) return;

      clearAutoDismiss(timer);
      if (timer.exitId !== undefined) {
        window.clearTimeout(timer.exitId);
      }
      timersRef.current.delete(id);
    },
    [clearAutoDismiss],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) {
        if (timer.autoDismissId !== undefined) window.clearTimeout(timer.autoDismissId);
        if (timer.exitId !== undefined) window.clearTimeout(timer.exitId);
      }
      timers.clear();
    };
  }, []);

  return useMemo<ToastTimers>(
    () => ({ schedule, pause, resume, armExit, cancel }),
    [schedule, pause, resume, armExit, cancel],
  );
}
