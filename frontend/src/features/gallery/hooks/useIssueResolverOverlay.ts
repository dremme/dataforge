import { useCallback, useState } from "react";
import { listResolvableIssueItems } from "@/features/gallery/lib/issues";
import type { GalleryItem } from "@/shared/types";

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
    // From state, not a setter callback: the return fires once, and a second close finds it clear.
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
