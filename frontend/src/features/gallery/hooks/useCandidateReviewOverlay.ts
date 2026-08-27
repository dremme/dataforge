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
        // Missing staging folder is the ordinary "nothing to review" case, not an error toast.
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
