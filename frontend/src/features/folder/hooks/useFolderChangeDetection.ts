import { useCallback, useEffect, useRef } from "react";
import { fetchFolderChanges, fetchFolderFingerprint } from "@/features/folder/api/folderContents";
import { isFolderNotFoundError } from "@/shared/api/http";
import type { FolderChangesResponse } from "@/shared/types";

const VISIBLE_POLL_MS = 3000;
const HIDDEN_POLL_MS = 30000;
const RELOAD_DEBOUNCE_MS = 1500;

export type UseFolderChangeDetectionOptions = {
  /** Skip folder reloads while a job is mutating the current folder. */
  suspendReloads?: boolean;
  /** Stop polling when the current folder is already known to be missing. */
  enabled?: boolean;
  /**
   * Patch the open folder from a delta.
   *
   * Given one, a change that the server can describe item by item never reaches
   * `reloadFolder` — the common case of a caption being rewritten costs one item
   * instead of the whole folder. Everything else still falls back to a full reload.
   */
  applyDelta?: (delta: FolderChangesResponse) => void;
};

export function useFolderChangeDetection(
  folderPath: string | undefined,
  knownFingerprint: string | undefined,
  reloadFolder: () => Promise<unknown>,
  { suspendReloads = false, enabled = true, applyDelta }: UseFolderChangeDetectionOptions = {},
) {
  const fingerprintRef = useRef<string | null>(null);
  const reloadInFlightRef = useRef(false);
  const reloadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFingerprintRef = useRef<string | null>(null);
  const missingFolderHandledRef = useRef(false);

  useEffect(() => {
    if (knownFingerprint) {
      fingerprintRef.current = knownFingerprint;
    }
  }, [knownFingerprint]);

  const clearPendingReload = useCallback(() => {
    if (reloadDebounceRef.current != null) {
      clearTimeout(reloadDebounceRef.current);
      reloadDebounceRef.current = null;
    }
    pendingFingerprintRef.current = null;
  }, []);

  const reportMissingFolder = useCallback(() => {
    if (missingFolderHandledRef.current) {
      return;
    }

    missingFolderHandledRef.current = true;
    void reloadFolder();
  }, [reloadFolder]);

  const syncBaseline = useCallback(async () => {
    if (!folderPath || !enabled) return;

    try {
      const { fingerprint } = await fetchFolderFingerprint(folderPath);
      fingerprintRef.current = fingerprint;
    } catch (error) {
      if (isFolderNotFoundError(error)) {
        reportMissingFolder();
      }
    }
  }, [enabled, folderPath, reportMissingFolder]);

  const runReload = useCallback(async () => {
    if (!folderPath || reloadInFlightRef.current) {
      return;
    }

    const nextFingerprint = pendingFingerprintRef.current;
    pendingFingerprintRef.current = null;
    reloadDebounceRef.current = null;

    if (!nextFingerprint || nextFingerprint === fingerprintRef.current) {
      return;
    }

    fingerprintRef.current = nextFingerprint;
    reloadInFlightRef.current = true;

    try {
      await reloadFolder();
    } finally {
      reloadInFlightRef.current = false;
    }
  }, [folderPath, reloadFolder]);

  const scheduleReload = useCallback(
    (fingerprint: string) => {
      pendingFingerprintRef.current = fingerprint;
      if (reloadDebounceRef.current != null) {
        clearTimeout(reloadDebounceRef.current);
      }

      reloadDebounceRef.current = setTimeout(() => {
        void runReload();
      }, RELOAD_DEBOUNCE_MS);
    },
    [runReload],
  );

  /**
   * The folder's current fingerprint, with a delta whenever one is both available
   * and usable. Without a baseline to diff against, or without somewhere to apply a
   * delta, asking for the cheaper fingerprint alone is the whole answer.
   */
  const fetchChangeReport = useCallback(
    async (path: string, previous: string | null): Promise<FolderChangesResponse> => {
      if (previous && applyDelta) {
        return fetchFolderChanges(path, previous);
      }

      const { fingerprint } = await fetchFolderFingerprint(path);
      return { full: true, fingerprint, changed: [], removed: [] };
    },
    [applyDelta],
  );

  const checkForChanges = useCallback(async () => {
    if (!folderPath || !enabled) return;

    const previous = fingerprintRef.current;

    try {
      const report = await fetchChangeReport(folderPath, previous);

      if (!previous) {
        fingerprintRef.current = report.fingerprint;
        return;
      }

      if (report.fingerprint === previous) {
        return;
      }

      if (suspendReloads) {
        fingerprintRef.current = report.fingerprint;
        return;
      }

      if (reloadInFlightRef.current) {
        pendingFingerprintRef.current = report.fingerprint;
        return;
      }

      // A described change is applied straight away: patching costs nothing, so
      // the debounce that protects a full reload would only add latency.
      if (!report.full && applyDelta) {
        fingerprintRef.current = report.fingerprint;
        applyDelta(report);
        return;
      }

      scheduleReload(report.fingerprint);
    } catch (error) {
      if (isFolderNotFoundError(error)) {
        reportMissingFolder();
      }
    }
  }, [
    applyDelta,
    enabled,
    fetchChangeReport,
    folderPath,
    reportMissingFolder,
    scheduleReload,
    suspendReloads,
  ]);

  useEffect(() => {
    missingFolderHandledRef.current = false;
  }, [folderPath]);

  useEffect(() => {
    return () => {
      clearPendingReload();
    };
  }, [clearPendingReload, folderPath]);

  useEffect(() => {
    if (!suspendReloads) {
      return;
    }

    clearPendingReload();
  }, [clearPendingReload, suspendReloads]);

  useEffect(() => {
    if (!folderPath || !enabled) return;

    let cancelled = false;
    let timeoutId = 0;

    const scheduleNext = (delayMs: number) => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        void tick();
      }, delayMs);
    };

    const tick = async () => {
      if (cancelled) return;

      await checkForChanges();
      if (cancelled) return;

      scheduleNext(document.visibilityState === "visible" ? VISIBLE_POLL_MS : HIDDEN_POLL_MS);
    };

    scheduleNext(VISIBLE_POLL_MS);

    const handleVisibilityChange = () => {
      if (cancelled) return;

      if (document.visibilityState === "visible") {
        void checkForChanges().finally(() => {
          if (!cancelled) {
            scheduleNext(VISIBLE_POLL_MS);
          }
        });
        return;
      }

      scheduleNext(HIDDEN_POLL_MS);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, folderPath, checkForChanges]);

  return { syncBaseline };
}
