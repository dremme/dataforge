import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { prefetchFolder } from "@/features/folder/lib/folderQuery";

/** Long enough that sweeping the pointer across a grid of folders lists none of them. */
export const PREFETCH_INTENT_MS = 150;

/** Pointer handlers that list a folder once the pointer rests on it, so opening paints at once. */
export function useFolderPrefetch() {
  const queryClient = useQueryClient();
  const timerRef = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  return useCallback(
    (path: string) => ({
      onPointerEnter: () => {
        cancel();
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          void prefetchFolder(queryClient, path);
        }, PREFETCH_INTENT_MS);
      },
      onPointerLeave: cancel,
    }),
    [cancel, queryClient],
  );
}
