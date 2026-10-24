import { useCallback, useEffect, useRef, useState } from "react";
import { useStaleRequest } from "./useStaleRequest";
import { useLatestRef } from "@/shared/hooks/useLatestRef";

/** `conflict`: the server refused a save as stale; saving stays paused until it is resolved. */
export type SaveState = "idle" | "pending" | "saving" | "saved" | "error" | "conflict";

export const DEFAULT_DEBOUNCE_MS = 500;
const DEFAULT_FEEDBACK_CLEAR_MS = 3000;

interface UseDebouncedSaveOptions<T> {
  debounceMs?: number;
  feedbackClearMs?: number;
  errorMessage?: string;
  save: (payload: T) => Promise<void>;
  isUnchanged: (payload: T, lastSaved: T) => boolean;
  /** A save this says is stale pauses autosave instead of failing like any other error. */
  isConflict?: (error: unknown) => boolean;
}

export function useDebouncedSave<T>({
  debounceMs = DEFAULT_DEBOUNCE_MS,
  feedbackClearMs = DEFAULT_FEEDBACK_CLEAR_MS,
  errorMessage = "Failed to save",
  save,
  isUnchanged,
  isConflict,
}: UseDebouncedSaveOptions<T>) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { next, isCurrent, invalidate } = useStaleRequest();
  const lastSavedRef = useRef<T | null>(null);
  const pendingSaveRef = useRef<T | null>(null);
  const failedSaveRef = useRef<T | null>(null);
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  // Set by a conflict: edits keep collecting, but nothing is sent until `resolveConflict`.
  const blockedRef = useRef(false);
  // Mirrors `inFlightRef` for rendering; a newer edit can show "pending" while a save still runs.
  const [saving, setSaving] = useState(false);

  const saveRef = useLatestRef(save);
  const isUnchangedRef = useLatestRef(isUnchanged);
  const isConflictRef = useLatestRef(isConflict);

  const clearFeedbackTimer = useCallback(() => {
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
  }, []);

  const showSaved = useCallback(() => {
    clearFeedbackTimer();
    setSaveState("saved");
    setSaveError(null);
    feedbackTimerRef.current = setTimeout(() => {
      setSaveState("idle");
      feedbackTimerRef.current = null;
    }, feedbackClearMs);
  }, [clearFeedbackTimer, feedbackClearMs]);

  // An error stays until the next edit or retry: it outlives the save it belongs to.
  const showError = useCallback(
    (message?: string) => {
      clearFeedbackTimer();
      setSaveState("error");
      setSaveError(message ?? errorMessage);
    },
    [clearFeedbackTimer, errorMessage],
  );

  const persist = useCallback(
    (payload: T): Promise<boolean> => {
      const requestId = next();
      const previous = inFlightRef.current;
      clearFeedbackTimer();
      setSaveState("saving");
      setSaveError(null);
      const request = (async () => {
        if (previous) await previous;
        try {
          await saveRef.current(payload);
          if (isCurrent(requestId)) {
            lastSavedRef.current = payload;
            failedSaveRef.current = null;
            showSaved();
          }
          return true;
        } catch (err) {
          if (isCurrent(requestId)) {
            failedSaveRef.current = payload;
            if (isConflictRef.current?.(err)) {
              blockedRef.current = true;
              clearFeedbackTimer();
              setSaveState("conflict");
              setSaveError(err instanceof Error ? err.message : errorMessage);
            } else {
              showError(err instanceof Error ? err.message : errorMessage);
            }
          }
          return false;
        }
      })();
      inFlightRef.current = request;
      setSaving(true);
      void request.then(() => {
        if (inFlightRef.current !== request) return;
        inFlightRef.current = null;
        setSaving(false);
      });
      return request;
    },
    [
      clearFeedbackTimer,
      errorMessage,
      isConflictRef,
      isCurrent,
      next,
      saveRef,
      showError,
      showSaved,
    ],
  );

  const flushPendingSave = useCallback(
    (retryFailed = false) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (blockedRef.current) return Promise.resolve(false);

      const pending = pendingSaveRef.current;
      const baseline = lastSavedRef.current;

      if (
        !pending ||
        (!inFlightRef.current && baseline !== null && isUnchangedRef.current(pending, baseline))
      ) {
        pendingSaveRef.current = null;
        if (!inFlightRef.current && retryFailed && failedSaveRef.current !== null) {
          return persist(failedSaveRef.current);
        }
        return inFlightRef.current ?? Promise.resolve(failedSaveRef.current === null);
      }

      pendingSaveRef.current = null;
      return persist(pending);
    },
    [isUnchangedRef, persist],
  );

  const scheduleSave = useCallback(
    (payload: T) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }

      pendingSaveRef.current = payload;
      // Kept while blocked: the text that conflicted is what an overwrite sends if nothing newer.
      if (blockedRef.current) return;
      failedSaveRef.current = null;
      const baseline = lastSavedRef.current;

      if (!inFlightRef.current && baseline !== null && isUnchangedRef.current(payload, baseline)) {
        pendingSaveRef.current = null;
        clearFeedbackTimer();
        setSaveState("idle");
        setSaveError(null);
        return;
      }

      clearFeedbackTimer();
      setSaveState("pending");
      setSaveError(null);
      saveTimerRef.current = setTimeout(() => {
        pendingSaveRef.current = null;
        void persist(payload);
      }, debounceMs);
    },
    [clearFeedbackTimer, debounceMs, isUnchangedRef, persist],
  );

  /** Re-sends the payload whose save failed. No-op once anything else has been scheduled. */
  const retrySave = useCallback(() => {
    if (blockedRef.current) return Promise.resolve(false);
    const failed = failedSaveRef.current;
    if (!failed) return Promise.resolve(true);
    return persist(failed);
  }, [persist]);

  /** Lets saving go on after a conflict; the caller has adopted the server's newer revision. */
  const resolveConflict = useCallback(() => {
    blockedRef.current = false;
    setSaveState(pendingSaveRef.current || failedSaveRef.current ? "pending" : "idle");
    setSaveError(null);
  }, []);

  const setBaseline = useCallback((baseline: T) => {
    lastSavedRef.current = baseline;
    blockedRef.current = false;
    failedSaveRef.current = null;
    setSaveState("idle");
    setSaveError(null);
  }, []);

  const invalidateInFlight = useCallback(() => {
    invalidate();
    inFlightRef.current = null;
    setSaving(false);
    clearFeedbackTimer();
  }, [clearFeedbackTimer, invalidate]);

  const discardPendingSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    pendingSaveRef.current = null;
    failedSaveRef.current = null;
    blockedRef.current = false;
    invalidateInFlight();
    setSaveState("idle");
    setSaveError(null);
  }, [invalidateInFlight]);

  const hasUnsavedChanges = useCallback(
    (current: T) => {
      if (inFlightRef.current) return true;
      const pending = pendingSaveRef.current;
      const baseline = lastSavedRef.current;

      if (pending !== null) {
        if (baseline === null) return true;
        return !isUnchangedRef.current(pending, baseline);
      }

      if (baseline === null) return false;
      return !isUnchangedRef.current(current, baseline);
    },
    [isUnchangedRef],
  );

  useEffect(() => {
    return () => {
      flushPendingSave();
      invalidate();
      clearFeedbackTimer();
    };
  }, [clearFeedbackTimer, flushPendingSave, invalidate]);

  return {
    saveState,
    saveError,
    scheduleSave,
    flushPendingSave,
    retrySave,
    resolveConflict,
    setBaseline,
    invalidateInFlight,
    hasUnsavedChanges,
    discardPendingSave,
    saving,
  };
}
