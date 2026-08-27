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

    // Cache miss lands path+loading together; the skeleton has no grid to restore onto.
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

  // Not a cleanup of the effect above: a silent reload would kill a settle still in flight.
  useEffect(
    () => () => {
      cancelRef.current?.();
      cancelRef.current = null;
    },
    [],
  );
}
