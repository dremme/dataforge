import { useCallback, useState } from "react";
import { fetchDuplicateGroups } from "@/features/gallery/api/duplicates";
import { duplicateOpenOutcome } from "@/features/gallery/lib/duplicates";
import { formatApiError } from "@/shared/api/http";
import { useNotify } from "@/shared/notifications/notifications";
import type { DuplicateGroup } from "@/shared/types";

/**
 * Duplicate resolver queue state.
 *
 * Unlike the issue resolver, the queue is fetched rather than filtered out of the
 * folder listing: a group's membership lives across several files' sidecars, and only
 * the backend can assemble it from the group ids they share.
 *
 * Which is also why opening can come up empty on a folder whose toolbar says otherwise.
 * The count comes from sidecars, one per flagged file; the queue comes from groups, and
 * a file whose partners are gone keeps its sidecar without belonging to anything. Those
 * findings are reported rather than cleared: the job that wrote them is what can rebuild
 * them, and nothing here can tell a spent finding from one the folder lost some other
 * way. Every outcome is announced - an open that shows nothing must not look like a
 * button that does nothing.
 */
export function useDuplicateResolverOverlay(onResolved?: () => void) {
  const notify = useNotify();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  // Assume the worst until the backend says otherwise: a stale `true` would drop the
  // confirmation in front of a delete that cannot be undone.
  const [deletesToTrash, setDeletesToTrash] = useState(false);

  const openDuplicateResolver = useCallback(
    async (folder: string, groupId?: string) => {
      try {
        const response = await fetchDuplicateGroups(folder);

        const outcome = duplicateOpenOutcome(response.stale.length, response.groups.length);
        if (outcome) notify(outcome);

        if (response.groups.length === 0) return;

        setGroups(response.groups);
        setDeletesToTrash(response.deletes_to_trash);
        // Opened from a specific card, start on that card's group rather than the first.
        const start = groupId ? response.groups.findIndex((group) => group.group === groupId) : -1;
        setIndex(start >= 0 ? start : 0);
        setOpen(true);
      } catch (caught) {
        notify({ variant: "danger", message: formatApiError(caught) });
      }
    },
    [notify],
  );

  const closeDuplicateResolver = useCallback(() => {
    setOpen(false);
    setIndex(0);
    setGroups([]);
    // The folder listing is stale the moment a group is resolved, so refresh on the
    // way out rather than after every single deletion.
    onResolved?.();
  }, [onResolved]);

  return {
    open,
    groups,
    index,
    openDuplicateResolver,
    closeDuplicateResolver,
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
