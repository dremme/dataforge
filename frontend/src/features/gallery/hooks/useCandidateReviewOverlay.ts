import { useCallback, useState } from "react";
import { fetchFolder } from "@/features/folder/api/folderContents";
import {
  buildCandidateReviewQueue,
  type CandidateReviewEntry,
} from "@/features/gallery/lib/candidateReview";
import { STAGING_DIR_NAME } from "@/shared/constants";
import { formatApiError, isFolderNotFoundError } from "@/shared/api/http";
import { useNotify } from "@/shared/notifications/notifications";
import type { GalleryItem } from "@/shared/types";

function stagingPath(folderPath: string): string {
  const separator = folderPath.includes("/") && !folderPath.includes("\\") ? "/" : "\\";
  return `${folderPath}${separator}${STAGING_DIR_NAME}`;
}

/**
 * Before/after review queue state.
 *
 * The queue is listed from the staging folder rather than filtered out of the gallery,
 * because a candidate is not a gallery item of the folder being reviewed - it lives one
 * level down, under the same filename. The dataset's own items come from what is already
 * loaded, so the pair is assembled without a second listing of the folder in view.
 *
 * Every outcome is announced. An empty staging folder and a missing one are the same
 * thing to the user - nothing to review - and neither may look like a button that did
 * nothing.
 */
export function useCandidateReviewOverlay(onResolved?: () => void) {
  const notify = useNotify();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [entries, setEntries] = useState<CandidateReviewEntry[]>([]);

  const openCandidateReview = useCallback(
    async (folderPath: string, items: readonly GalleryItem[]) => {
      try {
        const staging = await fetchFolder(stagingPath(folderPath));
        const candidates = staging.items.filter((item) => item.media_type !== "sysprompt");

        if (candidates.length === 0) {
          notify({ variant: "warning", message: "No candidates are waiting for review." });
          return;
        }

        setEntries(buildCandidateReviewQueue(folderPath, items, candidates));
        setIndex(0);
        setOpen(true);
      } catch (caught) {
        // A folder that was never created is the ordinary "nothing to review" case, not
        // a failure worth an error toast.
        if (isFolderNotFoundError(caught)) {
          notify({ variant: "warning", message: "No candidates are waiting for review." });
          return;
        }
        notify({ variant: "danger", message: formatApiError(caught) });
      }
    },
    [notify],
  );

  const closeCandidateReview = useCallback(() => {
    setOpen(false);
    setIndex(0);
    setEntries([]);
    // The folder listing is stale the moment a candidate is accepted, so it is
    // refreshed on the way out rather than after every single decision.
    onResolved?.();
  }, [onResolved]);

  return {
    open,
    entries,
    index,
    openCandidateReview,
    closeCandidateReview,
    overlay: {
      open,
      entries,
      index,
      onClose: closeCandidateReview,
      onIndexChange: setIndex,
      onResolved: () => onResolved?.(),
    },
  };
}
