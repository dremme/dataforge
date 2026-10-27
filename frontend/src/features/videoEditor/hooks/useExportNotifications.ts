import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { NotificationRecord, VideoProjectExportState } from "@/shared/types";
import { useNotificationActions, type ToastAction } from "@/shared/notifications/notifications";
import { VIDEO_EXPORTS_QUERY_KEY } from "@/features/videoEditor/hooks/useVideoExports";

/**
 * A finished export's notification offers to open the file it wrote. ``onOpen`` is null while
 * the editor is open, which has its own Open and must flush its draft before leaving.
 */
export function useExportNotifications(onOpen: ((path: string) => void) | null) {
  const queryClient = useQueryClient();

  // Read from the cache, not a render: the outcome's event can land before a re-render.
  const actionFor = useCallback(
    (record: NotificationRecord): ToastAction | undefined => {
      if (!onOpen || record.variant !== "success" || !record.job_id) return undefined;
      const finished = queryClient
        .getQueryData<VideoProjectExportState[]>(VIDEO_EXPORTS_QUERY_KEY)
        ?.find((item) => item.id === record.job_id);
      if (!finished) return undefined;
      return { label: "Open", run: () => onOpen(finished.output_path) };
    },
    [onOpen, queryClient],
  );
  useNotificationActions("video-exports", actionFor);
}
