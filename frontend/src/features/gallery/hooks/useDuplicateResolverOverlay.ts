import { useCallback, useState } from "react";
import { fetchDuplicateGroups } from "@/features/gallery/api/duplicates";
import { duplicateOpenOutcome } from "@/features/gallery/lib/duplicates";
import { formatApiError } from "@/shared/api/http";
import { useNotify } from "@/shared/notifications/notifications";
import type { DuplicateGroup } from "@/shared/types";

export function useDuplicateResolverOverlay(onResolved?: () => void) {
  const notify = useNotify();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  // Assume the worst until the backend says otherwise: a stale true skips confirmation.
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
      onResolved: () => onResolved?.(),
    },
  };
}
