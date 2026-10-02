import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addFolderFavorite,
  fetchFolderFavorites,
  removeFolderFavorite,
} from "@/features/folder/api/folders";
import {
  cacheFolderFavorites,
  optimisticallyAddFavorite,
  optimisticallyRemoveFavorite,
  readCachedFolderFavorites,
} from "@/features/folder/lib/folderFavorites";
import { folderPathsEqual, normalizeFolderPath } from "@/features/folder/lib/folderPath";
import { mirroredPreference } from "@/shared/query/refreshPolicies";
import type { FolderFavorite } from "@/shared/types";

const FAVORITES_QUERY_KEY = ["folder-favorites"] as const;

/** Reconciles only this folder, preserving other pending or completed toggles. */
function mergeFavorite(
  current: FolderFavorite[],
  path: string,
  source: FolderFavorite[],
): FolderFavorite[] {
  const sourceIndex = source.findIndex((entry) => folderPathsEqual(entry.path, path));
  const currentIndex = current.findIndex((entry) => folderPathsEqual(entry.path, path));
  const next = optimisticallyRemoveFavorite(current, path);
  if (sourceIndex >= 0) {
    next.splice(currentIndex >= 0 ? currentIndex : sourceIndex, 0, source[sourceIndex]);
  }
  return next;
}

function adopt(favorites: FolderFavorite[]): FolderFavorite[] {
  cacheFolderFavorites(favorites);
  return favorites;
}

export function useFolderFavorites({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: FAVORITES_QUERY_KEY,
    queryFn: async () => adopt((await fetchFolderFavorites()).favorites),
    ...mirroredPreference(readCachedFolderFavorites),
    enabled,
  });
}

export interface FavoriteToggle {
  path: string;
  /** Whether the folder is a favorite now, i.e. whether this toggle removes it. */
  isFavorite: boolean;
}

/** Shows the toggle at once; a refresh still in flight is dropped, a failed save is undone. */
export function useToggleFolderFavorite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ path, isFavorite }: FavoriteToggle) => {
      const normalized = normalizeFolderPath(path);
      const response = isFavorite
        ? await removeFolderFavorite(normalized)
        : await addFolderFavorite(normalized);
      return response.favorites;
    },
    onMutate: async ({ path, isFavorite }) => {
      await queryClient.cancelQueries({ queryKey: FAVORITES_QUERY_KEY });
      const previous = queryClient.getQueryData<FolderFavorite[]>(FAVORITES_QUERY_KEY) ?? [];
      const optimistic = isFavorite
        ? optimisticallyRemoveFavorite(previous, path)
        : optimisticallyAddFavorite(previous, path);
      queryClient.setQueryData(FAVORITES_QUERY_KEY, adopt(optimistic));
      return { previous };
    },
    onError: (_error, { path }, context) => {
      if (!context) return;
      queryClient.setQueryData<FolderFavorite[]>(FAVORITES_QUERY_KEY, (current) =>
        adopt(mergeFavorite(current ?? [], path, context.previous)),
      );
    },
    onSuccess: (favorites, { path }) => {
      queryClient.setQueryData<FolderFavorite[]>(FAVORITES_QUERY_KEY, (current) =>
        adopt(mergeFavorite(current ?? [], path, favorites)),
      );
    },
  });
}
