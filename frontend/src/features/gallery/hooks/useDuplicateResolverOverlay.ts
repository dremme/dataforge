import { useCallback, useState } from "react";
import { fetchDuplicateGroups } from "@/features/gallery/api/duplicates";
import { formatApiError } from "@/shared/api/http";
import type { DuplicateGroup } from "@/shared/types";

/**
 * Duplicate resolver queue state.
 *
 * Unlike the issue resolver, the queue is fetched rather than filtered out of the
 * folder listing: a group's membership lives across several files' sidecars, and only
 * the backend can assemble it from the group ids they share.
 */
export function useDuplicateResolverOverlay(onResolved?: () => void) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Assume the worst until the backend says otherwise: a stale `true` would drop the
  // confirmation in front of a delete that cannot be undone.
  const [deletesToTrash, setDeletesToTrash] = useState(false);

  const openDuplicateResolver = useCallback(async (folder: string, groupId?: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchDuplicateGroups(folder);
      if (response.groups.length === 0) {
        setError("No duplicate groups left in this folder.");
        return;
      }

      setGroups(response.groups);
      setDeletesToTrash(response.deletes_to_trash);
      // Opened from a specific card, start on that card's group rather than the first.
      const start = groupId ? response.groups.findIndex((group) => group.group === groupId) : -1;
      setIndex(start >= 0 ? start : 0);
      setOpen(true);
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  const closeDuplicateResolver = useCallback(() => {
    setOpen(false);
    setIndex(0);
    setGroups([]);
    // The folder listing is stale the moment a group is resolved, so refresh on the
    // way out rather than after every single deletion.
    onResolved?.();
  }, [onResolved]);

  const dismissError = useCallback(() => setError(null), []);

  return {
    open,
    groups,
    index,
    loading,
    error,
    openDuplicateResolver,
    closeDuplicateResolver,
    dismissError,
    overlay: {
      open,
      groups,
      index,
      onClose: closeDuplicateResolver,
      onIndexChange: setIndex,
      deletesToTrash,
      // Fires per resolved group. The folder watcher would push the deletions on its
      // own, but that lands a beat later and the grid is what the user returns to.
      onResolved: () => onResolved?.(),
    },
  };
}
