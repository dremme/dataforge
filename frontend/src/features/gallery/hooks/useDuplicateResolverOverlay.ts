import { useCallback, useRef, useState } from "react";
import { fetchDuplicateGroups } from "@/features/gallery/api/duplicates";
import { duplicateOpenOutcome } from "@/features/gallery/lib/duplicates";
import { pathBaseName } from "@/features/gallery/lib/mediaActionMessages";
import { formatApiError } from "@/shared/api/http";
import { useNotify } from "@/shared/notifications/notifications";
import type { DuplicateGroup } from "@/shared/types";

export interface DuplicateResolverFocus {
  /** The file whose group alone is shown; listings never say which group that is. */
  path: string;
  /** Runs in the same commit that opens the resolver, so the file's dialog never overlaps it. */
  onOpen: () => void;
}

export function useDuplicateResolverOverlay(
  onResolved?: () => void,
  onReturnToItem?: (path: string) => void,
) {
  const notify = useNotify();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  // A ref: the dialog settles its last group and closes in one tick, before state would update.
  const returnPathRef = useRef<string | null>(null);
  // Assume the worst until the backend says otherwise: a stale true skips confirmation.
  const [deletesToTrash, setDeletesToTrash] = useState(false);

  const openDuplicateResolver = useCallback(
    async (folder: string, focus?: DuplicateResolverFocus, selectedPaths?: ReadonlySet<string>) => {
      try {
        const response = await fetchDuplicateGroups(folder);

        const outcome = duplicateOpenOutcome(response.stale.length, response.groups.length);
        if (outcome && !focus) notify(outcome);

        // Whole groups: a selected file needs its unselected copies to be compared against.
        const shown = response.groups.filter((group) =>
          group.members.some(
            (member) =>
              (!focus || member.path === focus.path) &&
              (!selectedPaths || selectedPaths.has(member.path)),
          ),
        );

        if (shown.length === 0) {
          if (focus) {
            notify({
              variant: "warning",
              message: `${pathBaseName(focus.path)} has no duplicate left to compare.`,
            });
          } else if (selectedPaths && !outcome) {
            notify({
              variant: "warning",
              message: "No duplicate group includes the selected files.",
            });
          }
          return;
        }

        focus?.onOpen();
        setGroups(shown);
        setDeletesToTrash(response.deletes_to_trash);
        setIndex(0);
        returnPathRef.current = focus?.path ?? null;
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
    const returnPath = returnPathRef.current;
    returnPathRef.current = null;
    if (returnPath) onReturnToItem?.(returnPath);
  }, [onResolved, onReturnToItem]);

  const handleResolved = useCallback(
    (deletedPaths: string[]) => {
      // The listing still holds a file deleted a moment ago, so it cannot answer this.
      if (returnPathRef.current && deletedPaths.includes(returnPathRef.current)) {
        returnPathRef.current = null;
      }
      onResolved?.();
    },
    [onResolved],
  );

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
      onResolved: handleResolved,
    },
  };
}
