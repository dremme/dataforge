import { useCallback, useEffect, useRef, useState } from "react";
import { useStaleRequest } from "./useStaleRequest";

export type SaveState = "idle" | "saved" | "error";

const DEFAULT_DEBOUNCE_MS = 500;
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

  const showFeedback = useCallback(
    (state: "saved" | "error", message?: string) => {
      clearFeedbackTimer();
      setSaveState(state);
      setSaveError(state === "error" ? (message ?? errorMessage) : null);
      feedbackTimerRef.current = setTimeout(() => {
        setSaveState("idle");
        setSaveError(null);
        feedbackTimerRef.current = null;
      }, feedbackClearMs);
    },
    [clearFeedbackTimer, errorMessage, feedbackClearMs],
  );

  const persist = useCallback(
    async (payload: T) => {
      const requestId = next();
      clearFeedbackTimer();
      setSaveState("idle");
      setSaveError(null);

      try {
        await saveRef.current(payload);
        if (!isCurrent(requestId)) return;

        lastSavedRef.current = payload;
        showFeedback("saved");
      } catch (err) {
        if (!isCurrent(requestId)) return;

        showFeedback("error", err instanceof Error ? err.message : errorMessage);
      }
    },
    [clearFeedbackTimer, errorMessage, isCurrent, next, showFeedback],
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
      const baseline = lastSavedRef.current;

      if (baseline !== null && isUnchangedRef.current(payload, baseline)) {
        pendingSaveRef.current = null;
        clearFeedbackTimer();
        setSaveState("idle");
        setSaveError(null);
        return;
      }

      clearFeedbackTimer();
      setSaveState("idle");
      setSaveError(null);
      saveTimerRef.current = setTimeout(() => {
        pendingSaveRef.current = null;
        void persist(payload);
      }, debounceMs);
    },
    [clearFeedbackTimer, debounceMs, persist],
  );

  const setBaseline = useCallback((baseline: T) => {
    lastSavedRef.current = baseline;
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
    setBaseline,
    invalidateInFlight,
    hasUnsavedChanges,
  };
}
