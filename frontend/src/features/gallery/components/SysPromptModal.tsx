import { useCallback, useState } from "react";
import { getGalleryItemCaptionDisplay } from "@/features/gallery/lib/captionStatus";
import { saveSysPrompt } from "@/features/gallery/api/captions";
import { formatApiError } from "@/shared/api/http";
import { ModalShell } from "@/shared/ui/ModalShell";
import { iconX } from "@/shared/icons";
import type { GalleryItem, SysPromptSaveResponse } from "@/shared/types";
import { classNames } from "@/shared/lib/classNames";
import { estimateTokens } from "@/shared/lib/format";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { DialogButton } from "@/shared/ui/Dialog";
import { Icon } from "@/shared/ui/Icon";
import { MarkdownEditor } from "@/shared/ui/MarkdownEditor";

interface SysPromptModalProps {
  item: GalleryItem;
  onClose: () => void;
  onSaved: (path: string, update: SysPromptSaveResponse) => void;
}

export function SysPromptModal({ item, onClose, onSaved }: SysPromptModalProps) {
  // Opened-with text, captured once. AppOverlays keys this modal by path, so a folder echo
  // for the same file remounts nothing and leaves the draft alone.
  const [openedWith] = useState(() => item.description ?? "");
  const [draft, setDraft] = useState(openedWith);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);

  const edited = draft !== openedWith;

  const handleChange = useCallback((value: string) => {
    setDraft(value);
    setSaveError(null);
  }, []);

  const handleReset = useCallback(() => {
    setDraft(openedWith);
    setSaveError(null);
  }, [openedWith]);

  const handleSave = useCallback(async () => {
    if (saving || !edited) return;

    setSaving(true);
    try {
      const result = await saveSysPrompt(item.path, draft);
      onSaved(item.path, result);
      onClose();
    } catch (error) {
      // Stay open with the draft intact; a failed save must never cost the text.
      setSaveError(formatApiError(error));
    } finally {
      setSaving(false);
    }
  }, [draft, edited, item.path, onClose, onSaved, saving]);

  // The one exit path: close button, Escape, backdrop and Cancel all land here.
  const requestClose = useCallback(() => {
    if (saving) return;
    if (edited) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  }, [edited, onClose, saving]);

  const characterCount = draft.length;
  const tokenCount = estimateTokens(draft);
  const captionDisplay = getGalleryItemCaptionDisplay(item, "system prompt");
  const placeholder =
    captionDisplay.variant === "success"
      ? "Edit the folder system prompt..."
      : "Write a system prompt for this folder...";

  return (
    <ModalShell
      block="sysprompt-modal"
      label="Edit system prompt"
      onClose={requestClose}
      busy={saving}
      suspended={discardOpen}
      escape="editor"
      // useGalleryOverlays holds the session lock; measuring depth here would drop the blur.
      nested={false}
    >
      <header className="sysprompt-modal__header">
        <div className="sysprompt-modal__header-text">
          <div className="sysprompt-modal__header-copy">
            <h2 className="sysprompt-modal__title">{item.name}</h2>
            <p className="sysprompt-modal__subtitle">
              These instructions apply to all captioning work in this folder. Using markdown
              formatting will help the model understand them more effectively.
            </p>
          </div>
        </div>
        <div className="sysprompt-modal__header-actions">
          <button
            type="button"
            className="sysprompt-modal__close"
            onClick={requestClose}
            disabled={saving}
            aria-label="Close"
          >
            <Icon icon={iconX} />
          </button>
        </div>
      </header>

      <div className="sysprompt-modal__body">
        <MarkdownEditor
          id="sysprompt-editor"
          className={classNames(
            `code-editor--${captionDisplay.variant}`,
            saveError && "code-editor--error",
          )}
          value={draft}
          placeholder={placeholder}
          aria-label="System prompt"
          aria-invalid={saveError !== null}
          editable={!saving}
          onChange={handleChange}
        />
      </div>

      {saveError && (
        <p className="sysprompt-modal__error" role="alert">
          {saveError}
        </p>
      )}

      <footer className="sysprompt-modal__footer">
        <div className="sysprompt-modal__meta" aria-label="Prompt statistics">
          <div className="sysprompt-modal__meta-value">
            {characterCount.toLocaleString()} characters
          </div>
          <span className="sysprompt-modal__meta-divider" aria-hidden="true" />
          <div
            className="sysprompt-modal__meta-value"
            title="Estimated from text length; the exact count depends on the model"
          >
            ~{tokenCount.toLocaleString()} tokens
          </div>
        </div>

        <DialogButton
          label="Reset"
          variant="secondary"
          disabled={saving || !edited}
          onClick={handleReset}
        />
        <DialogButton label="Cancel" variant="secondary" disabled={saving} onClick={requestClose} />
        <DialogButton
          label={saving ? "Saving..." : "Save"}
          variant="primary"
          busy={saving}
          disabled={!edited}
          onClick={() => {
            void handleSave();
          }}
        />
      </footer>

      {discardOpen && (
        <ConfirmDialog
          title="Discard changes?"
          description="The system prompt will stay as it was when you opened it. This cannot be undone."
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          confirmVariant="danger"
          onConfirm={onClose}
          onCancel={() => setDiscardOpen(false)}
        />
      )}
    </ModalShell>
  );
}
