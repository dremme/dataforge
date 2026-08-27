import { useEffect, useState } from "react";
import { fetchGifInfo } from "@/features/gallery/api/media";
import { deferNonCriticalWork } from "@/shared/lib/defer";
import { useStaleRequest } from "@/shared/hooks/useStaleRequest";

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
