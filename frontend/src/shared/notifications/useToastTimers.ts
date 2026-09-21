import { useCallback, useEffect, useMemo, useRef } from "react";
import { NOTIFICATION_EXIT_MS } from "./notifications";

interface ToastTimer {
  autoDismissId?: number;
  exitId?: number;
  remainingMs: number;
  /** Absolute `performance.now()` deadline, or undefined while the pointer holds the toast. */
  deadlineMs?: number;
}

export interface ToastTimers {
  schedule: (id: string, durationMs: number) => void;
  pause: (id: string) => void;
  resume: (id: string) => void;
  /** Arms the removal that follows the exit animation; false when one is already running. */
  armExit: (id: string) => boolean;
  cancel: (id: string) => void;
}

export function useToastTimers(onExpire: (id: string) => void, onRemove: (id: string) => void) {
  const timersRef = useRef(new Map<string, ToastTimer>());
  const onExpireRef = useRef(onExpire);
  const onRemoveRef = useRef(onRemove);
  onExpireRef.current = onExpire;
  onRemoveRef.current = onRemove;

  const clearAutoDismiss = useCallback((timer: ToastTimer) => {
    if (timer.autoDismissId !== undefined) {
      window.clearTimeout(timer.autoDismissId);
      timer.autoDismissId = undefined;
    }
    timer.deadlineMs = undefined;
  }, []);

  const schedule = useCallback(
    (id: string, durationMs: number) => {
      const timer = timersRef.current.get(id) ?? { remainingMs: durationMs };
      timersRef.current.set(id, timer);
      clearAutoDismiss(timer);

      const remainingMs = Math.max(0, durationMs);
      timer.remainingMs = remainingMs;

      if (remainingMs === 0) {
        onExpireRef.current(id);
        return;
      }

      timer.deadlineMs = performance.now() + remainingMs;
      timer.autoDismissId = window.setTimeout(() => {
        const current = timersRef.current.get(id);
        if (current) {
          current.autoDismissId = undefined;
          current.deadlineMs = undefined;
        }
        onExpireRef.current(id);
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
      if (!timer || timer.autoDismissId !== undefined) return;

      schedule(id, timer.remainingMs);
    },
    [schedule],
  );

  const armExit = useCallback((id: string) => {
    const timer = timersRef.current.get(id) ?? { remainingMs: 0 };
    timersRef.current.set(id, timer);

    if (timer.exitId !== undefined) return false;

    timer.exitId = window.setTimeout(() => onRemoveRef.current(id), NOTIFICATION_EXIT_MS);
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
