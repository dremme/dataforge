import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { fetchFolderChanges, fetchSubfolderStats } from "@/features/folder/api/folderContents";
import {
  fetchFolderChildren,
  fetchFolderReviewCounts,
  fetchFolderRoots,
} from "@/features/folder/api/folders";
import { applyFolderDelta } from "@/features/folder/lib/applyFolderDelta";
import { folderKey } from "@/features/folder/lib/folderPath";
import { loadFolderContents } from "@/features/folder/lib/folderPreferences";
import { carrySubfolderCounts } from "@/features/folder/lib/subfolderCounts";
import type { FolderChild, FolderResponse, SubfolderStats } from "@/shared/types";

/** A listing this young is shown as is; older ones are revalidated when shown again. */
export const FOLDER_STALE_MS = 5_000;
/** Listings can be megabytes, so only this many folders stay cached once left. */
export const MAX_INACTIVE_FOLDERS = 10;

/** Stands for "wherever the server opens", until the answer names the folder. */
const DEFAULT_FOLDER = "@default";

export const folderKeys = {
  folder: (path: string | undefined) =>
    ["folder", path === undefined ? DEFAULT_FOLDER : folderKey(path)] as const,
  roots: ["folder-roots"] as const,
  children: (path: string) => ["folder-children", folderKey(path)] as const,
  reviewCounts: (path: string) => ["folder-review-counts", folderKey(path)] as const,
  stats: (path: string, fingerprint: string) =>
    ["folder-stats", folderKey(path), fingerprint] as const,
  /** The listing fingerprint whose subfolder counts are held over and must be read again. */
  recount: (path: string) => ["folder-recount", folderKey(path)] as const,
};

/**
 * Every re-read asks what changed since the fingerprint already held, so the cached listing
 * is its own diff baseline and only a change the server cannot describe costs a full listing.
 */
async function readFolder(
  queryClient: QueryClient,
  path: string | undefined,
  signal: AbortSignal,
  opening = false,
): Promise<FolderResponse> {
  if (path === undefined) return loadFolderContents(undefined, { signal });

  const key = folderKeys.folder(path);
  const held = queryClient.getQueryData<FolderResponse>(key);

  if (held?.fingerprint) {
    const report = await fetchFolderChanges(held.path, held.fingerprint, signal, opening);
    if (!report.full) {
      // Re-read: a local patch made while the request was out must survive the delta.
      const next = applyFolderDelta(queryClient.getQueryData<FolderResponse>(key) ?? held, report);
      const stale = new Set(report.stale_subfolders);
      if (next.subfolders.some((entry) => stale.has(entry.path))) {
        queryClient.setQueryData(folderKeys.recount(next.path), next.fingerprint);
      }
      return next;
    }
  }

  const fresh = await loadFolderContents(path, { signal });
  if (!held || folderKey(held.path) !== folderKey(fresh.path)) return fresh;

  // A full listing leaves subfolder counts out. A job writing into a subfolder moves its mtime
  // and forces one; showing the old counts until the recount lands keeps the cards steady.
  const { subfolders, carried } = carrySubfolderCounts(held.subfolders, fresh.subfolders);
  if (!carried) return fresh;
  queryClient.setQueryData(folderKeys.recount(fresh.path), fresh.fingerprint);
  return { ...fresh, subfolders };
}

export function folderQueryOptions(path: string | undefined) {
  return queryOptions({
    queryKey: folderKeys.folder(path),
    queryFn: ({ client, signal }) => readFolder(client, path, signal),
    staleTime: FOLDER_STALE_MS,
    meta: { pushFed: true, inactiveLimit: MAX_INACTIVE_FOLDERS },
  });
}

/** Reads a folder the user is opening; it always re-reads, however fresh the cache. */
export function openFolderQuery(queryClient: QueryClient, path: string | undefined) {
  const options = folderQueryOptions(path);
  // Stale first: the request is also what tells the server this tab is looking again.
  void queryClient.invalidateQueries({
    queryKey: options.queryKey,
    exact: true,
    refetchType: "none",
  });
  return queryClient.fetchQuery({
    ...options,
    queryFn: ({ signal }) => readFolder(queryClient, path, signal, true),
  });
}

/**
 * Lists a folder the user is likely to open next, if it is not cached yet. Opening it still
 * re-reads it, which is what registers the watch and the last folder.
 */
export async function prefetchFolder(queryClient: QueryClient, path: string): Promise<void> {
  const options = folderQueryOptions(path);
  if (queryClient.getQueryData(options.queryKey)) return;

  await queryClient.prefetchQuery({
    ...options,
    queryFn: ({ signal }) => loadFolderContents(path, { signal, prefetch: true }),
  });
}

function mergeSubfolderStats(
  folder: FolderResponse,
  stats: Map<string, SubfolderStats>,
): FolderResponse {
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

  return changed ? { ...folder, subfolders } : folder;
}

/**
 * Counts for a listing's subfolders, written into that listing. Keyed by fingerprint: counts
 * belong to the listing they were read for, and a newer listing has to ask again. Always
 * stale, so a reload that blanks the counts under the same fingerprint asks again too.
 */
export function subfolderStatsQueryOptions(path: string, fingerprint: string) {
  return queryOptions({
    queryKey: folderKeys.stats(path, fingerprint),
    queryFn: async ({ client, signal }) => {
      const { subfolders } = await fetchSubfolderStats(path, signal);
      const stats = new Map(subfolders.map((entry) => [entry.path, entry]));

      client.setQueryData<FolderResponse>(folderKeys.folder(path), (folder) =>
        folder && folder.fingerprint === fingerprint ? mergeSubfolderStats(folder, stats) : folder,
      );
      client.setQueryData<string | null>(folderKeys.recount(path), (owed) =>
        owed === fingerprint ? null : owed,
      );
      return subfolders;
    },
  });
}

function sortChildren(children: FolderChild[]): FolderChild[] {
  return [...children].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/** A folder's child folders by name, as the breadcrumb menu and the transfer tree list them. */
export function folderChildrenQueryOptions(path: string) {
  return queryOptions({
    queryKey: folderKeys.children(path),
    queryFn: async ({ signal }) => sortChildren((await fetchFolderChildren(path, signal)).children),
  });
}

/** Caption issues and staged candidates under a folder, for its card's hover bubble. */
export function folderReviewCountsQueryOptions(path: string) {
  return queryOptions({
    queryKey: folderKeys.reviewCounts(path),
    queryFn: ({ signal }) => fetchFolderReviewCounts(path, signal),
    // A folder that cannot be counted just says so in the bubble.
    retry: false,
  });
}

/** The drives and home folder a folder tree starts from. */
export function folderRootsQueryOptions() {
  return queryOptions({
    queryKey: folderKeys.roots,
    queryFn: ({ signal }) => fetchFolderRoots(signal),
  });
}
