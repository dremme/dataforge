import { useEffect, type Dispatch, type SetStateAction } from "react";
import { fetchSubfolderStats } from "@/features/browse/api/browse";
import { writeCachedBrowse } from "@/features/browse/lib/browseCache";
import { isAbortError, isFolderNotFoundError } from "@/shared/api/http";
import type { BrowseResponse, Subfolder, SubfolderStats } from "@/shared/types";

function mergeStats(
  browse: BrowseResponse,
  stats: Map<string, SubfolderStats>,
): BrowseResponse | null {
  let changed = false;

  const subfolders = browse.subfolders.map((folder) => {
    const counts = stats.get(folder.path);
    if (!counts) return folder;
    if (
      counts.file_count === folder.file_count &&
      counts.captioned_count === folder.captioned_count &&
      counts.issue_count === folder.issue_count
    ) {
      return folder;
    }

    changed = true;
    return {
      ...folder,
      file_count: counts.file_count,
      captioned_count: counts.captioned_count,
      issue_count: counts.issue_count,
    };
  });

  return changed ? { ...browse, subfolders } : null;
}

/**
 * Fill in the per-folder caption counts once the grid is already on screen.
 *
 * Counting means reading every caption sidecar in every child folder, which is
 * what used to hold up the whole browse response. The cards render from names
 * alone and the numbers land a beat later.
 */
export function useSubfolderStats(
  folder: string | undefined,
  subfolders: Subfolder[],
  setBrowse: Dispatch<SetStateAction<BrowseResponse | null>>,
  enabled = true,
): void {
  // Keyed on whether counts are actually missing, not on the folder identity.
  // Every background reload - an import, a finished job, the change-detection
  // poll - swaps in a fresh payload whose subfolders have no counts, and both
  // the folder path and the subfolder count come back unchanged. Watching the
  // gap itself is what makes those reloads refetch instead of stranding the
  // cards on their placeholders. It settles because merging the counts closes
  // the gap, so the effect stops re-running rather than looping.
  const needsCounts = subfolders.some((entry) => entry.file_count === null);

  useEffect(() => {
    if (!enabled || !folder || !needsCounts) return;

    const controller = new AbortController();

    void (async () => {
      try {
        const { subfolders } = await fetchSubfolderStats(folder, controller.signal);
        if (controller.signal.aborted) return;

        const stats = new Map(subfolders.map((entry) => [entry.path, entry]));

        setBrowse((current) => {
          // The user may have navigated on while this was in flight.
          if (!current || current.folder !== folder) return current;

          const merged = mergeStats(current, stats);
          if (!merged) return current;

          // Cache the counted version so coming back here shows numbers at once.
          writeCachedBrowse(merged);
          return merged;
        });
      } catch (error) {
        // Counts are an enhancement: a failure leaves the cards without numbers
        // rather than taking down a folder that otherwise loaded fine. A folder
        // that vanished mid-flight is the browse request's problem to report.
        if (!isAbortError(error) && !isFolderNotFoundError(error)) {
          console.warn("Failed to load subfolder stats", error);
        }
      }
    })();

    return () => controller.abort();
  }, [enabled, folder, needsCounts, setBrowse]);
}
