import { useQuery } from "@tanstack/react-query";
import { fetchGifInfo } from "@/features/gallery/api/media";
import { deferNonCriticalWork } from "@/shared/lib/defer";

export function useGifFrameCount(path: string | undefined, enabled: boolean): number | undefined {
  const ready = Boolean(path) && enabled;

  const { data } = useQuery({
    queryKey: ["gif-frame-count", path],
    queryFn: async () => {
      await new Promise<void>((resolve) => deferNonCriticalWork(resolve));
      return (await fetchGifInfo(path!)).frame_count;
    },
    enabled: ready,
    retry: false,
  });

  return ready ? data : undefined;
}
