import { instructionApplies, type InstructionKind } from "@/shared/api/folderInstructions";
import { CAPTION_RULES_FILENAME, SYSPROMPT_FILENAME } from "@/shared/constants";
import type { FolderInstructionsState } from "@/shared/hooks/useFolderInstructions";
import { iconFileText, iconLoader2 } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";

const FILENAMES: Record<InstructionKind, string> = {
  sysprompt: SYSPROMPT_FILENAME,
  caption_rules: CAPTION_RULES_FILENAME,
};

interface InstructionFileSourceProps {
  state: FolderInstructionsState;
  kind: InstructionKind;
}

/** Names the instruction file a job will read, for a dialog footer. */
export function InstructionFileSource({ state, kind }: InstructionFileSourceProps) {
  const filename = FILENAMES[kind];

  if (state.status === "loading") {
    return (
      <p className="instruction-file-source" role="status">
        <Icon icon={iconLoader2} spin className="instruction-file-source__icon" />
        <span className="instruction-file-source__text">Loading {filename}...</span>
      </p>
    );
  }

  if (state.status === "error") return null;

  const file = state.instructions[kind];
  if (!instructionApplies(file)) return null;

  return (
    <p className="instruction-file-source">
      <Icon icon={iconFileText} className="instruction-file-source__icon" />
      <span className="instruction-file-source__text">
        Uses{" "}
        {file.has_file ? (
          <strong>{filename}</strong>
        ) : (
          <strong title={file.parent_folder ?? undefined}>{file.parent_relative_path}</strong>
        )}
      </span>
    </p>
  );
}
