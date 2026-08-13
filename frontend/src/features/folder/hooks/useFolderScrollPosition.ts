import { useEffect, useLayoutEffect, useRef } from "react";
import type { FolderScrollIntent } from "@/features/folder/hooks/useFolderNavigation";
import { folderPathsEqual } from "@/features/folder/lib/folderPath";
import { getAppScrollElement } from "@/shared/lib/appScroll";
import { settleScrollPosition } from "@/shared/lib/scrollSettle";

interface FolderScrollPositionOptions {
  intent: FolderScrollIntent | null;
  folderPath: string | undefined;
  loading: boolean;
  hasError: boolean;
}

/**
 * Applies the pending navigation's scroll intent once the destination folder
 * has content to scroll.
 *
 * Called from the workspace hook rather than from anything inside the gallery:
 * React runs layout effects child-first, so from the root component this fires
 * after the grid's own layout work and sees the finished DOM.
 */
export function useFolderScrollPosition({
  intent,
  folderPath,
  loading,
  hasError,
}: FolderScrollPositionOptions): void {
  const consumedIdRef = useRef(0);
  const cancelRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    if (!intent || intent.id === consumedIdRef.current) return;

    // A newer navigation always wins over a settle still chasing the last one.
    cancelRef.current?.();
    cancelRef.current = null;

    // On a cache miss the path change and the loading flag land in the same
    // commit, which renders the skeleton with the grid unmounted — applying
    // there would target an empty document and never get another chance.
    if (loading || !folderPath) return;

    const element = getAppScrollElement();
    if (!element) {
      consumedIdRef.current = intent.id;
      return;
    }

    // A failed load leaves an empty shell, and a redirected one lands somewhere
    // the saved offset never described; the top is the honest answer for both.
    const pathMatches = intent.path === undefined || folderPathsEqual(folderPath, intent.path);
    const target = intent.mode === "restore" && !hasError && pathMatches ? intent.target : 0;

    consumedIdRef.current = intent.id;
    cancelRef.current = settleScrollPosition(element, target);
  }, [intent, folderPath, loading, hasError]);

  // Deliberately not a cleanup on the effect above: an unrelated dependency
  // change, such as a silent reload swapping the folder object, would otherwise
  // kill a settle that is still legitimately in flight.
  useEffect(
    () => () => {
      cancelRef.current?.();
      cancelRef.current = null;
    },
    [],
  );
}
