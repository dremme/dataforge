import { useMutation, useQueryClient, type Query } from "@tanstack/react-query";
import { saveFolderNote } from "@/features/folder/api/folders";
import { folderPathsEqual } from "@/features/folder/lib/folderPath";
import type { FolderResponse } from "@/shared/types";

interface FolderNoteSave {
  path: string;
  /** Blank deletes the note. */
  text: string;
}

/**
 * Matches by the listing's own path: the folder opened at startup is cached under a
 * placeholder key, not its path.
 */
function holdsFolder(path: string) {
  return (query: Query) => {
    const data = query.state.data as FolderResponse | undefined;
    return query.queryKey[0] === "folder" && !!data && folderPathsEqual(data.path, path);
  };
}

export function useSaveFolderNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ path, text }: FolderNoteSave) => saveFolderNote(path, text),
    onSuccess: async ({ text }, { path }) => {
      const predicate = holdsFolder(path);
      queryClient.setQueriesData<FolderResponse>(
        { predicate },
        (current) => current && { ...current, note: text },
      );
      await queryClient.invalidateQueries({ predicate });
    },
  });
}
