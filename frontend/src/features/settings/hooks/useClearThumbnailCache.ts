import { useCallback, useState } from "react";
import { advanceThumbnailEpoch } from "@/features/gallery/lib/thumbnailEpoch";
import { formatApiError } from "@/shared/api/http";
import { formatCount, formatFileSize } from "@/shared/lib/format";
import { useNotify } from "@/shared/notifications/notifications";
import { clearThumbnailCache } from "../api/settings";

function describeThumbnailCount(count: number): string {
  return `${formatCount(count)} ${count === 1 ? "thumbnail" : "thumbnails"}`;
}

export function useClearThumbnailCache() {
  const notify = useNotify();
  const [clearing, setClearing] = useState(false);

  const clear = useCallback(async (): Promise<boolean> => {
    setClearing(true);
    try {
      const cleared = await clearThumbnailCache();
      advanceThumbnailEpoch();
      notify({
        variant: "success",
        message: `Cleared ${describeThumbnailCount(cleared.removed_files)} (${formatFileSize(cleared.freed_bytes)}). They are recreated as you browse.`,
      });
      return true;
    } catch (error) {
      notify({ variant: "danger", message: formatApiError(error) });
      return false;
    } finally {
      setClearing(false);
    }
  }, [notify]);

  return { clearing, clear };
}
