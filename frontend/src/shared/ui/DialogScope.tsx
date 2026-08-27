import type { ReactNode } from "react";
import { iconCheck, iconFolder } from "@/shared/icons";
import { Icon } from "./Icon";

export interface DialogScopeInfo {
  itemCount: number;
  folderLabel: string;
  fromSelection: boolean;
  note?: ReactNode;
}

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
