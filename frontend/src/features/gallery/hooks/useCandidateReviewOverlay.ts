import { useCallback, useState } from "react";
import { fetchFolder } from "@/features/folder/api/folderContents";
import {
  buildCandidateReviewQueue,
  type CandidateReviewEntry,
} from "@/features/gallery/lib/candidateReview";
import { STAGING_DIR_NAME } from "@/shared/constants";
import { pathBaseName } from "@/features/gallery/lib/mediaActionMessages";
import { formatApiError, isFolderNotFoundError } from "@/shared/api/http";
import { useNotify } from "@/shared/notifications/notifications";
import type { GalleryItem } from "@/shared/types";

function stagingPath(folderPath: string): string {
  const separator = folderPath.includes("/") && !folderPath.includes("\\") ? "/" : "\\";
  return `${folderPath}${separator}${STAGING_DIR_NAME}`;
}

const NOTHING_TO_REVIEW = "No candidates are waiting for review.";

export interface CandidateReviewFocus {
  path: string;
  /** Runs in the same commit that opens the review, so the file's modal never overlaps it. */
  onOpen: () => void;
}

export function useCandidateReviewOverlay(
  onResolved?: () => void,
  onReturnToItem?: (path: string) => void,
) {
  const notify = useNotify();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [entries, setEntries] = useState<CandidateReviewEntry[]>([]);
  const [returnPath, setReturnPath] = useState<string | null>(null);

  const openCandidateReview = useCallback(
    async (folderPath: string, items: readonly GalleryItem[], focus?: CandidateReviewFocus) => {
      try {
        const staging = await fetchFolder(stagingPath(folderPath));
        const candidates = staging.items.filter((item) => item.media_type !== "sysprompt");
        const queue = buildCandidateReviewQueue(folderPath, items, candidates).filter(
          (entry) => !focus || entry.path === focus.path,
        );

        if (queue.length === 0) {
          notify({
            variant: "warning",
            message: focus
              ? `No candidate is waiting for ${pathBaseName(focus.path)}.`
              : NOTHING_TO_REVIEW,
          });
          return;
        }

        focus?.onOpen();
        setEntries(queue);
        setIndex(0);
        setReturnPath(focus?.path ?? null);
        setOpen(true);
      } catch (caught) {
        // Missing staging folder is the ordinary "nothing to review" case, not an error toast.
        if (isFolderNotFoundError(caught)) {
          notify({ variant: "warning", message: NOTHING_TO_REVIEW });
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
    setReturnPath(null);
    onResolved?.();
    if (returnPath) {
      onReturnToItem?.(returnPath);
    }
  }, [onResolved, onReturnToItem, returnPath]);

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
