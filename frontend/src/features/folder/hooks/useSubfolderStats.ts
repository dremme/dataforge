import { skipToken, useQuery } from "@tanstack/react-query";
import { folderKeys, subfolderStatsQueryOptions } from "@/features/folder/lib/folderQuery";
import type { Subfolder } from "@/shared/types";

/** Fills in the counts a listing leaves out of its subfolders, which are slow to gather. */
export function useSubfolderStats(
  folderPath: string | undefined,
  fingerprint: string | undefined,
  subfolders: Subfolder[],
  enabled = true,
): void {
  // Written by the folder read when it kept old counts on screen; nothing fetches it.
  const { data: owedFingerprint } = useQuery<string | null>({
    queryKey: folderKeys.recount(folderPath ?? ""),
    queryFn: skipToken,
    enabled: Boolean(folderPath),
  });
  const needsCounts =
    (owedFingerprint != null && owedFingerprint === fingerprint) ||
    subfolders.some((entry) => entry.file_count == null);

  useQuery({
    ...subfolderStatsQueryOptions(folderPath ?? "", fingerprint ?? ""),
    enabled: enabled && Boolean(folderPath) && needsCounts,
    // The counts land in the folder listing; nothing reads this query's own state.
    notifyOnChangeProps: [],
  });
}
