import { useCallback, useEffect, useRef, useState } from "react";
import { useStaleRequest } from "./useStaleRequest";

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

export const DEFAULT_DEBOUNCE_MS = 500;
const DEFAULT_FEEDBACK_CLEAR_MS = 3000;

interface UseDebouncedSaveOptions<T> {
  debounceMs?: number;
  feedbackClearMs?: number;
  errorMessage?: string;
  save: (payload: T) => Promise<void>;
  isUnchanged: (payload: T, lastSaved: T) => boolean;
}

export function useDebouncedSave<T>({
  debounceMs = DEFAULT_DEBOUNCE_MS,
  feedbackClearMs = DEFAULT_FEEDBACK_CLEAR_MS,
  errorMessage = "Failed to save",
  save,
  isUnchanged,
}: UseDebouncedSaveOptions<T>) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { next, isCurrent, invalidate } = useStaleRequest();
  const lastSavedRef = useRef<T | null>(null);
  const pendingSaveRef = useRef<T | null>(null);
  const failedSaveRef = useRef<T | null>(null);
  const saveRef = useRef(save);
  const isUnchangedRef = useRef(isUnchanged);

  saveRef.current = save;
  isUnchangedRef.current = isUnchanged;

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
    async (payload: T) => {
      const requestId = next();
      clearFeedbackTimer();
      setSaveState("saving");
      setSaveError(null);

      try {
        await saveRef.current(payload);
        if (!isCurrent(requestId)) return;

        lastSavedRef.current = payload;
        failedSaveRef.current = null;
        showSaved();
      } catch (err) {
        if (!isCurrent(requestId)) return;

        failedSaveRef.current = payload;
        showError(err instanceof Error ? err.message : errorMessage);
      }
    },
    [clearFeedbackTimer, errorMessage, isCurrent, next, showError, showSaved],
  );

  const flushPendingSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const pending = pendingSaveRef.current;
    const baseline = lastSavedRef.current;

    if (!pending || (baseline !== null && isUnchangedRef.current(pending, baseline))) {
      pendingSaveRef.current = null;
      return;
    }

    pendingSaveRef.current = null;
    void persist(pending);
  }, [persist]);

  const scheduleSave = useCallback(
    (payload: T) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }

      pendingSaveRef.current = payload;
      failedSaveRef.current = null;
      const baseline = lastSavedRef.current;

      if (baseline !== null && isUnchangedRef.current(payload, baseline)) {
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
    [clearFeedbackTimer, debounceMs, persist],
  );

  /** Re-sends the payload whose save failed. No-op once anything else has been scheduled. */
  const retrySave = useCallback(() => {
    const failed = failedSaveRef.current;
    if (!failed) return;
    void persist(failed);
  }, [persist]);

  const setBaseline = useCallback((baseline: T) => {
    lastSavedRef.current = baseline;
    failedSaveRef.current = null;
    setSaveState("idle");
    setSaveError(null);
  }, []);

  const invalidateInFlight = useCallback(() => {
    invalidate();
    clearFeedbackTimer();
  }, [clearFeedbackTimer, invalidate]);

  const hasUnsavedChanges = useCallback((current: T) => {
    const pending = pendingSaveRef.current;
    const baseline = lastSavedRef.current;

    if (pending !== null) {
      if (baseline === null) return true;
      return !isUnchangedRef.current(pending, baseline);
    }

    if (baseline === null) return false;
    return !isUnchangedRef.current(current, baseline);
  }, []);

  useEffect(() => {
    return () => {
      flushPendingSave();
      clearFeedbackTimer();
    };
  }, [clearFeedbackTimer, flushPendingSave]);

  return {
    saveState,
    saveError,
    scheduleSave,
    flushPendingSave,
    retrySave,
    setBaseline,
    invalidateInFlight,
    hasUnsavedChanges,
  };
}
