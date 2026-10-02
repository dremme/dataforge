import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { folderKey } from "@/features/folder/lib/folderPath";
import { fetchFolderInstructions, type InstructionKind } from "@/shared/api/folderInstructions";
import { formatApiError } from "@/shared/api/http";
import type { FolderInstructionsResponse, InstructionFileResponse } from "@/shared/types";

export type FolderInstructionsState =
  | { status: "loading" }
  | { status: "ready"; instructions: FolderInstructionsResponse }
  | { status: "error"; message: string };

const instructionsKey = (folderPath: string) => ["folder-instructions", folderKey(folderPath)];

/** The folder's instruction files; `setFile` takes the response of a save. */
export function useFolderInstructions(folderPath: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: instructionsKey(folderPath),
    queryFn: ({ signal }) => fetchFolderInstructions(folderPath, signal),
  });

  const state: FolderInstructionsState = query.data
    ? { status: "ready", instructions: query.data }
    : query.isError
      ? { status: "error", message: formatApiError(query.error) }
      : { status: "loading" };

  const setFile = useCallback(
    (kind: InstructionKind, saved: InstructionFileResponse) =>
      queryClient.setQueryData<FolderInstructionsResponse>(
        instructionsKey(folderPath),
        (current) => current && { ...current, [kind]: saved },
      ),
    [folderPath, queryClient],
  );

  return { state, instructions: query.data ?? null, setFile };
}
