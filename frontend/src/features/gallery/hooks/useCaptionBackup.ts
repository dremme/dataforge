import { useEffect, useState } from "react";
import { fetchCaptionBackup } from "@/features/gallery/api/captions";
import { useStaleRequest } from "@/shared/hooks/useStaleRequest";

/** The backed-up caption for one file, or `null` when the folder has no backup of it. */
export function useCaptionBackup(itemPath: string | undefined, enabled: boolean): string | null {
  const [backup, setBackup] = useState<string | null>(null);
  const { next, isCurrent } = useStaleRequest();

  useEffect(() => {
    setBackup(null);

    if (!itemPath || !enabled) return;

    const requestId = next();

    fetchCaptionBackup(itemPath)
      .then((response) => {
        if (!isCurrent(requestId)) return;
        setBackup(response.exists ? (response.description ?? "") : null);
      })
      .catch(() => {
        // A folder whose backup disappeared simply offers nothing to restore.
      });
  }, [enabled, isCurrent, itemPath, next]);

  return backup;
}
