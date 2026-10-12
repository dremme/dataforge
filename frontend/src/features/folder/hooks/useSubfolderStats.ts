import { useEffect } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { folderKeys, subfolderStatsQueryOptions } from "@/features/folder/lib/folderQuery";
import type { Subfolder } from "@/shared/types";

/** Fills in the counts a listing leaves out of its subfolders, which are slow to gather. */
export function useSubfolderStats(
  folderPath: string | undefined,
  fingerprint: string | undefined,
  subfolders: Subfolder[],
  enabled = true,
): void {
  const queryClient = useQueryClient();
  const hasSubfolders = subfolders.length > 0;

  // Another program rewriting a caption in place leaves the subfolder's mtime, and so this
  // listing, untouched. Coming back from that program is the cue to count again.
  useEffect(() => {
    if (!enabled || !folderPath || !fingerprint || !hasSubfolders) return;

    const owe = () => queryClient.setQueryData(folderKeys.recount(folderPath), fingerprint);
    const oweIfShown = () => {
      if (document.visibilityState === "visible") owe();
    };
    window.addEventListener("focus", owe);
    document.addEventListener("visibilitychange", oweIfShown);
    return () => {
      window.removeEventListener("focus", owe);
      document.removeEventListener("visibilitychange", oweIfShown);
    };
  }, [enabled, fingerprint, folderPath, hasSubfolders, queryClient]);

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
