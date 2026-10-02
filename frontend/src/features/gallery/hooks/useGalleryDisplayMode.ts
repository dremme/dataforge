import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { folderKey } from "@/features/folder/lib/folderPath";
import { DEFAULT_DISPLAY_MODE } from "@/features/gallery/lib/displayMode";
import {
  fetchDisplayMode,
  readCachedDisplayMode,
  updateGalleryDisplayMode,
} from "@/features/gallery/preferences/galleryDisplayPreferences";
import type { GalleryDisplayMode } from "@/shared/types";
import { mirroredPreference } from "@/shared/query/refreshPolicies";

export const ALL_DISPLAY_MODES_KEY = ["display-mode"] as const;
export const displayModeKey = (folderPath: string) =>
  [...ALL_DISPLAY_MODES_KEY, folderKey(folderPath)] as const;

/** Cached folders paint at once from the mirror, so the default would flash. */
export function useGalleryDisplayMode(folderPath: string | undefined) {
  const queryClient = useQueryClient();
  const path = folderPath ?? "";

  const { data } = useQuery({
    queryKey: displayModeKey(path),
    queryFn: () => fetchDisplayMode(path),
    enabled: Boolean(folderPath),
    ...mirroredPreference(() => readCachedDisplayMode(folderPath) ?? undefined),
  });

  const { mutate } = useMutation({
    mutationFn: ({ path, mode }: { path: string; mode: GalleryDisplayMode }) =>
      updateGalleryDisplayMode(path, mode),
    onMutate: async ({ path, mode }) => {
      await queryClient.cancelQueries({ queryKey: displayModeKey(path) });
      queryClient.setQueryData(displayModeKey(path), mode);
    },
    // The choice stays applied and mirrored locally even when the save fails.
    onSuccess: (saved, { path }) => queryClient.setQueryData(displayModeKey(path), saved),
  });

  const setDisplayMode = useCallback(
    (mode: GalleryDisplayMode) => {
      if (folderPath) mutate({ path: folderPath, mode });
    },
    [folderPath, mutate],
  );

  return { displayMode: (folderPath && data) || DEFAULT_DISPLAY_MODE, setDisplayMode };
}
