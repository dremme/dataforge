import { useCallback, useEffect, useState } from "react";
import { fetchFolderInstructions, type InstructionKind } from "@/shared/api/folderInstructions";
import { formatApiError } from "@/shared/api/http";
import type { FolderInstructionsResponse, InstructionFileResponse } from "@/shared/types";

export type FolderInstructionsState =
  | { status: "loading" }
  | { status: "ready"; instructions: FolderInstructionsResponse }
  | { status: "error"; message: string };

/** The folder's instruction files; `setFile` takes the response of a save. */
export function useFolderInstructions(folderPath: string) {
  const [state, setState] = useState<FolderInstructionsState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    fetchFolderInstructions(folderPath, controller.signal).then(
      (instructions) => {
        if (!controller.signal.aborted) setState({ status: "ready", instructions });
      },
      (caught: unknown) => {
        if (!controller.signal.aborted) {
          setState({ status: "error", message: formatApiError(caught) });
        }
      },
    );

    return () => controller.abort();
  }, [folderPath]);

  const instructions = state.status === "ready" ? state.instructions : null;
  const setFile = useCallback(
    (kind: InstructionKind, saved: InstructionFileResponse) =>
      setState((current) =>
        current.status === "ready"
          ? { status: "ready", instructions: { ...current.instructions, [kind]: saved } }
          : current,
      ),
    [],
  );

  return { state, instructions, setFile };
}
