import { useQuery } from "@tanstack/react-query";
import { fetchCaptionBackup } from "@/features/gallery/api/captions";

/** The backed-up caption for one file, or `null` when the folder has no backup of it. */
export function useCaptionBackup(itemPath: string | undefined, enabled: boolean): string | null {
  const ready = Boolean(itemPath) && enabled;

  const { data } = useQuery({
    queryKey: ["caption-backup", itemPath],
    queryFn: async () => {
      const response = await fetchCaptionBackup(itemPath!);
      return response.exists ? (response.description ?? "") : null;
    },
    enabled: ready,
    // A folder whose backup disappeared simply offers nothing to restore.
    retry: false,
  });

  return ready ? (data ?? null) : null;
}
