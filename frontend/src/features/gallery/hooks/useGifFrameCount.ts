import { useEffect, useState } from "react";
import { fetchGifInfo } from "@/features/gallery/api/media";
import { deferNonCriticalWork } from "@/shared/lib/defer";
import { useStaleRequest } from "@/shared/hooks/useStaleRequest";

/**
 * How many frames a GIF holds, counted on demand.
 *
 * Kept off the gallery listing deliberately: counting means walking every frame,
 * and a listing builds hundreds of items in a thread pool. Only the frame-capture
 * bar needs this, so only it pays for it.
 */
export function useGifFrameCount(path: string | undefined, enabled: boolean): number | undefined {
  const [frameCount, setFrameCount] = useState<number | undefined>(undefined);
  const { next, isCurrent } = useStaleRequest();

  useEffect(() => {
    if (!path || !enabled) {
      setFrameCount(undefined);
      return;
    }

    const requestId = next();
    setFrameCount(undefined);

    return deferNonCriticalWork(() => {
      void fetchGifInfo(path)
        .then((result) => {
          if (!isCurrent(requestId)) return;
          setFrameCount(result.frame_count);
        })
        .catch(() => {
          if (!isCurrent(requestId)) return;
          setFrameCount(undefined);
        });
    });
  }, [enabled, isCurrent, next, path]);

  return frameCount;
}
