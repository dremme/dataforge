import { useCallback, useEffect, useState } from "react";
import { DEFAULT_DISPLAY_MODE } from "@/features/gallery/lib/displayMode";
import {
  loadGalleryDisplayMode,
  readCachedDisplayMode,
  updateGalleryDisplayMode,
} from "@/features/gallery/preferences/galleryDisplayPreferences";
import type { GalleryDisplayMode } from "@/shared/types";

/** Seeded from the local mirror: cached folders paint at once, so the default would flash. */
export function useGalleryDisplayMode(folderPath: string | undefined) {
  const [displayMode, setDisplayModeState] = useState<GalleryDisplayMode>(
    () => readCachedDisplayMode(folderPath) ?? DEFAULT_DISPLAY_MODE,
  );

  useEffect(() => {
    if (!folderPath) {
      setDisplayModeState(DEFAULT_DISPLAY_MODE);
      return;
    }

    // Re-seed before awaiting so navigation never shows the previous folder's mode.
    setDisplayModeState(readCachedDisplayMode(folderPath) ?? DEFAULT_DISPLAY_MODE);

    let cancelled = false;
    loadGalleryDisplayMode(folderPath).then((mode) => {
      if (!cancelled) {
        setDisplayModeState(mode);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [folderPath]);

  const setDisplayMode = useCallback(
    (mode: GalleryDisplayMode) => {
      setDisplayModeState(mode);
      if (!folderPath) return;

      updateGalleryDisplayMode(folderPath, mode).catch(() => {
        // UI already reflects the choice; ignore persistence failures.
      });
    },
    [folderPath],
  );

  return { displayMode, setDisplayMode };
}
