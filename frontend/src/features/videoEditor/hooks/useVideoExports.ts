import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useOptionalServerEvent } from "@/shared/events/serverEvents";
import type { VideoProjectExportState } from "@/shared/types";
import {
  cancelVideoProjectExport,
  dismissVideoProjectExport,
  listVideoProjectExports,
} from "@/features/videoEditor/api/videoProjects";

export const VIDEO_EXPORTS_QUERY_KEY = ["video-project-exports"] as const;

/** While one is running, in case the event stream is down (a hidden tab gives it up). */
const RUNNING_POLL_MS = 2000;

/** The later of two copies: a finished export never goes back to running, nor progress back. */
function newer(
  known: VideoProjectExportState | undefined,
  incoming: VideoProjectExportState,
): VideoProjectExportState {
  if (!known) return incoming;
  if (known.status !== "running" && incoming.status === "running") return known;
  if (known.status === "running" && incoming.status === "running") {
    return incoming.progress >= known.progress ? incoming : known;
  }
  return incoming;
}

export function mergeExport(
  current: VideoProjectExportState[] | undefined,
  state: VideoProjectExportState,
): VideoProjectExportState[] {
  const known = current?.find((item) => item.id === state.id);
  const others = (current ?? []).filter((item) => item.id !== state.id);
  return [newer(known, state), ...others].sort((a, b) => b.started_at.localeCompare(a.started_at));
}

/** Every export the server knows about, kept current by its broadcast events. */
export function useVideoExports() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: VIDEO_EXPORTS_QUERY_KEY,
    queryFn: async () => (await listVideoProjectExports()).exports,
    meta: { pushFed: true },
    staleTime: Infinity,
    refetchInterval: (query) =>
      query.state.data?.some((item) => item.status === "running") ? RUNNING_POLL_MS : false,
  });

  useOptionalServerEvent((event) => {
    if (event.type !== "video_project_export") return;
    queryClient.setQueryData<VideoProjectExportState[]>(VIDEO_EXPORTS_QUERY_KEY, (current) =>
      mergeExport(current, event.export),
    );
  });

  const track = useCallback(
    (state: VideoProjectExportState) =>
      queryClient.setQueryData<VideoProjectExportState[]>(VIDEO_EXPORTS_QUERY_KEY, (current) =>
        mergeExport(current, state),
      ),
    [queryClient],
  );

  const cancel = useCallback(
    async (id: string) => track(await cancelVideoProjectExport(id)),
    [track],
  );

  const dismiss = useCallback(
    async (id: string) => {
      queryClient.setQueryData<VideoProjectExportState[]>(VIDEO_EXPORTS_QUERY_KEY, (current) =>
        (current ?? []).filter((item) => item.id !== id),
      );
      await dismissVideoProjectExport(id);
    },
    [queryClient],
  );

  return { exports: query.data ?? [], track, cancel, dismiss };
}
