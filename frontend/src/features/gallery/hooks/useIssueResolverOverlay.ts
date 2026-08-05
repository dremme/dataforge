import { useCallback, useState } from "react";
import { listResolvableIssueItems } from "@/features/gallery/lib/issues";
import type { GalleryItem } from "@/shared/types";

/**
 * Issue resolver queue state. A session opened for one file carries the path it
 * came from, so closing hands control back there instead of dropping to the grid.
 */
export function useIssueResolverOverlay(onReturnToItem?: (path: string) => void) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [items, setItems] = useState<GalleryItem[]>(() => listResolvableIssueItems([]));
  const [returnPath, setReturnPath] = useState<string | null>(null);

  const openIssueResolver = useCallback((sourceItems: GalleryItem[], originPath?: string) => {
    setItems(listResolvableIssueItems(sourceItems));
    setIndex(0);
    setReturnPath(originPath ?? null);
    setOpen(true);
  }, []);

  const closeIssueResolver = useCallback(() => {
    setOpen(false);
    setIndex(0);
    setItems([]);
    setReturnPath(null);
    // Read from state, not from a setter callback: the return has to fire once
    // per close, and a second close finds `returnPath` already cleared.
    if (returnPath) {
      onReturnToItem?.(returnPath);
    }
  }, [onReturnToItem, returnPath]);

  return {
    open,
    items,
    index,
    setIndex,
    openIssueResolver,
    closeIssueResolver,
    overlay: {
      open,
      items,
      index,
      onClose: closeIssueResolver,
      onIndexChange: setIndex,
    },
  };
}
