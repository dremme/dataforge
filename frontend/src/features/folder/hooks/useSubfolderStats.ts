import { useEffect, type Dispatch, type SetStateAction } from "react";
import { fetchSubfolderStats } from "@/features/folder/api/folderContents";
import { writeCachedFolder } from "@/features/folder/lib/folderCache";
import { isAbortError, isFolderNotFoundError } from "@/shared/api/http";
import type { FolderResponse, Subfolder, SubfolderStats } from "@/shared/types";

function mergeStats(
  folder: FolderResponse,
  stats: Map<string, SubfolderStats>,
): FolderResponse | null {
  let changed = false;

  const subfolders = folder.subfolders.map((subfolder) => {
    const counts = stats.get(subfolder.path);
    if (!counts) return subfolder;
    if (
      counts.file_count === subfolder.file_count &&
      counts.captioned_count === subfolder.captioned_count &&
      counts.issue_count === subfolder.issue_count &&
      counts.duplicate_count === subfolder.duplicate_count
    ) {
      return subfolder;
    }

    changed = true;
    return {
      ...subfolder,
      file_count: counts.file_count,
      captioned_count: counts.captioned_count,
      issue_count: counts.issue_count,
      duplicate_count: counts.duplicate_count,
    };
  });

  return changed ? { ...folder, subfolders } : null;
}

export function useSubfolderStats(
  folderPath: string | undefined,
  fingerprint: string | undefined,
  subfolders: Subfolder[],
  setFolder: Dispatch<SetStateAction<FolderResponse | null>>,
  enabled = true,
): void {
  // Missing counts say a fetch is due; the fingerprint says which listing the answer describes.
  // Both, because a reload that lands mid-flight leaves the counts missing but makes them stale.
  const needsCounts = subfolders.some((entry) => entry.file_count == null);

  useEffect(() => {
    if (!enabled || !folderPath || !needsCounts) return;

    const controller = new AbortController();

    void (async () => {
      try {
        const { subfolders } = await fetchSubfolderStats(folderPath, controller.signal);
        if (controller.signal.aborted) return;

        const stats = new Map(subfolders.map((entry) => [entry.path, entry]));

        setFolder((current) => {
          if (!current || current.path !== folderPath) return current;
          // Counts belong to the listing they were read from; a newer one has to ask again.
          if (current.fingerprint !== fingerprint) return current;

          const merged = mergeStats(current, stats);
          if (!merged) return current;

          writeCachedFolder(merged);
          return merged;
        });
      } catch (error) {
        if (!isAbortError(error) && !isFolderNotFoundError(error)) {
          console.warn("Failed to load subfolder stats", error);
        }
      }
    })();

    return () => controller.abort();
  }, [enabled, fingerprint, folderPath, needsCounts, setFolder]);
}
