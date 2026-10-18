import { useState } from "react";
import { useSaveFolderNote } from "@/features/folder/hooks/useSaveFolderNote";
import { formatApiError } from "@/shared/api/http";
import { iconStickyNote, iconTrash2 } from "@/shared/icons";
import { useNotify } from "@/shared/notifications/notifications";
import { ConfirmModal } from "@/shared/ui/ConfirmModal";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";

interface FolderNoteBannerProps {
  folderPath: string;
  note: string;
}

export function FolderNoteBanner({ folderPath, note }: FolderNoteBannerProps) {
  const [confirming, setConfirming] = useState(false);
  const save = useSaveFolderNote();
  const notify = useNotify();

  const remove = () =>
    save.mutate(
      { path: folderPath, text: "" },
      {
        onSuccess: () => setConfirming(false),
        onError: (error) => {
          setConfirming(false);
          notify({ variant: "danger", message: formatApiError(error) });
        },
      },
    );

  return (
    <aside className="folder-note" aria-label="Folder note">
      <Icon icon={iconStickyNote} className="folder-note__icon" />
      <p className="folder-note__text">{note}</p>
      <Tooltip content="Delete note">
        <button
          type="button"
          className="folder-note__delete"
          aria-label="Delete note"
          onClick={() => setConfirming(true)}
        >
          <Icon icon={iconTrash2} />
        </button>
      </Tooltip>
      {confirming && (
        <ConfirmModal
          title="Delete this note?"
          description="The note is removed from this folder. This cannot be undone."
          confirmLabel="Delete note"
          confirmVariant="danger"
          busy={save.isPending}
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
        />
      )}
    </aside>
  );
}
