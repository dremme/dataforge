import { useQuery } from "@tanstack/react-query";
import { subfolderStatsQueryOptions } from "@/features/folder/lib/folderQuery";
import type { Subfolder } from "@/shared/types";

/** Fills in the counts a listing leaves out of its subfolders, which are slow to gather. */
export function useSubfolderStats(
  folderPath: string | undefined,
  fingerprint: string | undefined,
  subfolders: Subfolder[],
  enabled = true,
): void {
  const needsCounts = subfolders.some((entry) => entry.file_count == null);

  useQuery({
    ...subfolderStatsQueryOptions(folderPath ?? "", fingerprint ?? ""),
    enabled: enabled && Boolean(folderPath) && needsCounts,
    // The counts land in the folder listing; nothing reads this query's own state.
    notifyOnChangeProps: [],
  });
}
