import { useQuery } from "@tanstack/react-query";
import { fetchGifInfo } from "@/features/gallery/api/media";
import { mediaCacheKey } from "@/features/gallery/lib/thumbnail";
import { deferNonCriticalWork } from "@/shared/lib/defer";
import type { GalleryItem } from "@/shared/types";

type GifSource = Pick<GalleryItem, "path" | "modified_at" | "size">;

export function useGifFrameCount(
  item: GifSource | undefined,
  enabled: boolean,
): number | undefined {
  const path = item?.path;
  const ready = Boolean(path) && enabled;

  const { data } = useQuery({
    // Versioned like the GIF's URLs, so a file replaced at the same path is counted again.
    queryKey: ["gif-frame-count", path, mediaCacheKey(item?.modified_at, item?.size)],
    queryFn: async () => {
      await new Promise<void>((resolve) => deferNonCriticalWork(resolve));
      return (await fetchGifInfo(path!)).frame_count;
    },
    enabled: ready,
    retry: false,
  });

  return ready ? data : undefined;
}
