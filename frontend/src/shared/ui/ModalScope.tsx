import type { ReactNode } from "react";
import { iconCheck, iconFolder } from "@/shared/icons";
import { Icon } from "./Icon";
import type { BulkScopeKind } from "@/features/automation/lib/bulkScope";

export interface ModalScopeInfo {
  itemCount: number;
  folderLabel: string;
  kind: BulkScopeKind;
  note?: ReactNode;
}

export function ModalScope({ itemCount, folderLabel, kind, note }: ModalScopeInfo) {
  const files = itemCount === 1 ? "file" : "files";

  return (
    <div className="modal-scope">
      <p className="modal-scope__line">
        <Icon icon={kind === "selected" ? iconCheck : iconFolder} className="modal-scope__icon" />
        <span>
          {kind === "selected" ? (
            <>
              <strong>{itemCount}</strong> selected {files}
            </>
          ) : (
            <>
              {kind === "visible" ? "Matching" : "All"} <strong>{itemCount}</strong> {files}
            </>
          )}{" "}
          in <strong className="modal-scope__folder">{folderLabel}</strong>
        </span>
      </p>
      {note && <p className="modal-scope__note">{note}</p>}
    </div>
  );
}
