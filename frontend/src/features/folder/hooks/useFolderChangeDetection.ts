import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { foldersMatch } from "@/features/folder/lib/folderPath";
import { folderKeys, folderQueryOptions } from "@/features/folder/lib/folderQuery";
import { useServerEvent } from "@/shared/events/serverEvents";
import type { FolderResponse } from "@/shared/types";
import { useLatestRef } from "@/shared/hooks/useLatestRef";

export const VISIBLE_POLL_MS = 30000;
export const HIDDEN_POLL_MS = 60000;
/** Pushed changes re-read the folder at most this often; the last one in a burst always lands. */
export const RELOAD_THROTTLE_MS = 1500;

/** Leading and trailing: the first call runs at once, later ones fold into one at the end. */
function useThrottled(run: () => void, intervalMs: number) {
  const lastRunRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const runRef = useLatestRef(run);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const schedule = useCallback(() => {
    const wait = lastRunRef.current + intervalMs - Date.now();
    if (wait <= 0) {
      lastRunRef.current = Date.now();
      runRef.current();
      return;
    }
    timerRef.current ??= window.setTimeout(() => {
      timerRef.current = null;
      lastRunRef.current = Date.now();
      runRef.current();
    }, wait);
  }, [intervalMs, runRef]);

  useEffect(() => cancel, [cancel]);

  return { schedule, cancel };
}

/**
 * Keeps the open folder's listing current: server pushes, a slow poll as a safety net, and a
 * check when the tab comes back. Each re-read asks for changes since the listing it holds.
 */
export function useFolderChangeDetection(folderPath: string | undefined) {
  const queryClient = useQueryClient();
  const live = Boolean(folderPath);
  const key = useMemo(() => folderKeys.folder(folderPath), [folderPath]);

  const { data } = useQuery({
    ...folderQueryOptions(folderPath),
    enabled: live,
    refetchInterval: () =>
      document.visibilityState === "visible" ? VISIBLE_POLL_MS : HIDDEN_POLL_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
    notifyOnChangeProps: ["data"],
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: key, exact: true });
  }, [queryClient, key]);

  const { schedule, cancel } = useThrottled(refresh, RELOAD_THROTTLE_MS);

  // A push that lands while the first listing is still in flight is checked once it arrives.
  const pendingFingerprintRef = useRef<string | null>(null);

  useEffect(() => {
    pendingFingerprintRef.current = null;
    cancel();
  }, [cancel, folderPath, live]);

  const heldFingerprint = data?.fingerprint;
  useEffect(() => {
    const pending = pendingFingerprintRef.current;
    if (!pending || heldFingerprint === undefined) return;
    pendingFingerprintRef.current = null;
    if (pending !== heldFingerprint) schedule();
  }, [heldFingerprint, schedule]);

  useServerEvent((event) => {
    if (event.type !== "folder" || !folderPath || !live) return;
    // Watcher keys are folded; a just-navigated tab can still get an event for the old folder.
    if (!foldersMatch(event.path, folderPath)) return;

    // A failed read retries on any news of its folder: it may be back with the same files.
    if (queryClient.getQueryState(key)?.status === "error") {
      schedule();
      return;
    }

    const held = queryClient.getQueryData<FolderResponse>(key);
    if (!held) {
      pendingFingerprintRef.current = event.fingerprint;
      return;
    }
    if (event.fingerprint !== held.fingerprint) schedule();
  });

  /**
   * After writing to the folder itself: re-read what changed. Adopting the server's fingerprint
   * instead would also absorb whatever else changed meanwhile, such as a running job's files.
   */
  const syncBaseline = useCallback(async () => {
    if (!folderPath) return;
    await queryClient.invalidateQueries({ queryKey: key, exact: true });
  }, [folderPath, key, queryClient]);

  return { syncBaseline };
}
