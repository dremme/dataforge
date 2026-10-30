import { splitFileName } from "@/features/gallery/lib/fileName";
import { RenameDialog } from "@/shared/ui/RenameDialog";

interface FileRenameDialogProps {
  fileName: string;
  busy: boolean;
  suspended?: boolean;
  error: string | null;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function FileRenameDialog({
  fileName,
  busy,
  suspended,
  error,
  onConfirm,
  onCancel,
}: FileRenameDialogProps) {
  const { stem, extension } = splitFileName(fileName);

  return (
    <RenameDialog
      title="Rename file"
      description={
        <span>
          Renames <strong>{fileName}</strong> together with its captions and other related files.
          {extension && (
            <>
              {" "}
              The extension <strong>{extension}</strong> stays.
            </>
          )}
        </span>
      }
      fieldLabel="File name"
      initialName={stem}
      busy={busy}
      suspended={suspended}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
