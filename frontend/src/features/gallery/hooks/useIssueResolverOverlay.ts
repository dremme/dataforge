import { useCallback, useState } from "react";
import { listResolvableIssueItems } from "@/features/gallery/lib/issues";
import type { GalleryItem } from "@/shared/types";

export function useIssueResolverOverlay() {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [items, setItems] = useState<GalleryItem[]>(() => listResolvableIssueItems([]));

  const openIssueResolver = useCallback((sourceItems: GalleryItem[]) => {
    setItems(listResolvableIssueItems(sourceItems));
    setIndex(0);
    setOpen(true);
  }, []);

  const closeIssueResolver = useCallback(() => {
    setOpen(false);
    setIndex(0);
    setItems([]);
  }, []);

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
