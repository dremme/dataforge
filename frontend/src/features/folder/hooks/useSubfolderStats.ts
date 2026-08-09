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
      counts.issue_count === subfolder.issue_count
    ) {
      return subfolder;
    }

    changed = true;
    return {
      ...subfolder,
      file_count: counts.file_count,
      captioned_count: counts.captioned_count,
      issue_count: counts.issue_count,
    };
  });

  return changed ? { ...folder, subfolders } : null;
}

/**
 * Fill in the per-folder caption counts once the grid is already on screen.
 *
 * Counting means reading every caption sidecar in every child folder, which is
 * what used to hold up the whole folder response. The cards render from names
 * alone and the numbers land a beat later.
 */
export function useSubfolderStats(
  folderPath: string | undefined,
  subfolders: Subfolder[],
  setFolder: Dispatch<SetStateAction<FolderResponse | null>>,
  enabled = true,
): void {
  // Keyed on whether counts are actually missing, not on the folder identity.
  // Every background reload - an import, a finished job, the change-detection
  // poll - swaps in a fresh payload whose subfolders have no counts, and both
  // the folder path and the subfolder count come back unchanged. Watching the
  // gap itself is what makes those reloads refetch instead of stranding the
  // cards on their placeholders. It settles because merging the counts closes
  // the gap, so the effect stops re-running rather than looping.
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
          // The user may have navigated on while this was in flight.
          if (!current || current.path !== folderPath) return current;

          const merged = mergeStats(current, stats);
          if (!merged) return current;

          // Cache the counted version so coming back here shows numbers at once.
          writeCachedFolder(merged);
          return merged;
        });
      } catch (error) {
        // Counts are an enhancement: a failure leaves the cards without numbers
        // rather than taking down a folder that otherwise loaded fine. A folder
        // that vanished mid-flight is the folder request's problem to report.
        if (!isAbortError(error) && !isFolderNotFoundError(error)) {
          console.warn("Failed to load subfolder stats", error);
        }
      }
    })();

    return () => controller.abort();
  }, [enabled, folderPath, needsCounts, setFolder]);
}
