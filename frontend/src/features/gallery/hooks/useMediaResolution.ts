import { useCallback, useState } from "react";
import type { GalleryItem } from "@/shared/types";

export interface MediaResolution {
  width: number;
  height: number;
}

export function useMediaResolution() {
  const [resolutions, setResolutions] = useState<Record<string, MediaResolution>>({});

  const recordResolution = useCallback((width: number, height: number, path: string) => {
    if (width <= 0 || height <= 0) return;

    setResolutions((prev) => {
      const existing = prev[path];
      if (existing?.width === width && existing?.height === height) {
        return prev;
      }
      return { ...prev, [path]: { width, height } };
    });
  }, []);

  const getResolution = useCallback(
    (item: GalleryItem | undefined): MediaResolution | undefined => {
      if (!item) return undefined;
      if (item.width && item.height) {
        return { width: item.width, height: item.height };
      }
      return resolutions[item.path];
    },
    [resolutions],
  );

  return { recordResolution, getResolution };
}
