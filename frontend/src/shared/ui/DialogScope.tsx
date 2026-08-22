import type { ReactNode } from "react";
import { iconCheck, iconFolder } from "@/shared/icons";
import { Icon } from "./Icon";

export interface DialogScopeInfo {
  /** Files this job or action will actually touch — the selection, or the folder. */
  itemCount: number;
  /** Name of the folder those files live in, not its full path. */
  folderLabel: string;
  /** True when a selection is narrowing this to part of the folder. */
  fromSelection: boolean;
  /**
   * Why the scope is what it is, when that would otherwise surprise — LoRA
   * training is folder-wide however much is selected, and says so here.
   */
  note?: ReactNode;
}

/**
 * States what a dialog is about to run on, in one place and one wording.
 *
 * Carried as a whole object rather than a bare `folderLabel` so a dialog cannot
 * name a folder without also saying how much of it is in scope — the ambiguity
 * this row exists to remove. Rendered by `Dialog` above the description, so the
 * scope is always in the same spot regardless of what the job explains below.
 */
export function DialogScope({ itemCount, folderLabel, fromSelection, note }: DialogScopeInfo) {
  const files = itemCount === 1 ? "file" : "files";

  return (
    <div className="dialog-scope">
      <p className="dialog-scope__line">
        <Icon icon={fromSelection ? iconCheck : iconFolder} className="dialog-scope__icon" />
        <span>
          {fromSelection ? (
            <>
              <strong>{itemCount}</strong> selected {files}
            </>
          ) : (
            <>
              All <strong>{itemCount}</strong> {files}
            </>
          )}{" "}
          in <strong className="dialog-scope__folder">{folderLabel}</strong>
        </span>
      </p>
      {note && <p className="dialog-scope__note">{note}</p>}
    </div>
  );
}
