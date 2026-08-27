import { useCallback, useEffect, useRef, useState } from "react";
import { getGalleryItemCaptionDisplay } from "@/features/gallery/lib/captionStatus";
import { saveSysPrompt } from "@/features/gallery/api/captions";
import { useDebouncedSave } from "@/shared/hooks/useDebouncedSave";
import { ModalShell } from "@/shared/ui/ModalShell";
import { iconX } from "@/shared/icons";
import type { GalleryItem, SysPromptSaveResponse } from "@/shared/types";
import { classNames } from "@/shared/lib/classNames";
import { countWords } from "@/shared/lib/format";
import { Icon } from "@/shared/ui/Icon";
import { MarkdownEditor } from "@/shared/ui/MarkdownEditor";

type SysPromptSavePayload = {
  path: string;
  text: string;
};

interface SysPromptModalProps {
  item: GalleryItem;
  onClose: () => void;
  onSaved: (path: string, update: SysPromptSaveResponse) => void;
}

export function SysPromptModal({ item, onClose, onSaved }: SysPromptModalProps) {
  const [prompt, setPrompt] = useState(() => item.description ?? "");
  const syncedRevisionRef = useRef<string | null>(null);

  const persistSysPrompt = useCallback(
    async (payload: SysPromptSavePayload) => {
      const result = await saveSysPrompt(payload.path, payload.text);
      onSaved(payload.path, result);
    },
    [onSaved],
  );

  const { saveState, saveError, scheduleSave, flushPendingSave, setBaseline, invalidateInFlight } =
    useDebouncedSave<SysPromptSavePayload>({
      errorMessage: "Failed to save system prompt",
      save: persistSysPrompt,
      isUnchanged: (pending, lastSaved) => pending.text === lastSaved.text,
    });

  useEffect(() => {
    const revision = JSON.stringify({ path: item.path, description: item.description ?? "" });
    if (syncedRevisionRef.current === revision) {
      return;
    }

    const previousRevision = syncedRevisionRef.current;
    const isInitial = previousRevision === null;
    const previousPath = isInitial ? null : (JSON.parse(previousRevision) as { path: string }).path;

    syncedRevisionRef.current = revision;

    if (!isInitial && previousPath === item.path) {
      // Keep local editor state while this modal stays open for the same file.
      return;
    }

    flushPendingSave();
    invalidateInFlight();
    const incoming = item.description ?? "";
    setPrompt(incoming);
    setBaseline({ path: item.path, text: incoming });
  }, [flushPendingSave, invalidateInFlight, item.description, item.path, setBaseline]);

  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    flushPendingSave();
    onClose();
  }, [flushPendingSave, onClose]);

  const characterCount = prompt.length;
  const wordCount = countWords(prompt);
  const captionDisplay = getGalleryItemCaptionDisplay(item, "system prompt");
  const placeholder =
    captionDisplay.variant === "success"
      ? "Edit the folder system prompt..."
      : "Write a system prompt for this folder...";

  const handleChange = (value: string) => {
    setPrompt(value);
    scheduleSave({ path: item.path, text: value });
  };

  return (
    <ModalShell
      block="sysprompt-modal"
      label="Edit system prompt"
      onClose={close}
      escape="editor"
      // useGalleryOverlays holds the session lock; measuring depth here would drop the blur.
      nested={false}
      panelRef={panelRef}
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
            onClick={close}
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
            saveState !== "idle" && `code-editor--${saveState}`,
          )}
          value={prompt}
          placeholder={placeholder}
          aria-label="System prompt"
          aria-invalid={saveState === "error"}
          title={saveState === "error" ? (saveError ?? "Save failed") : undefined}
          onChange={handleChange}
        />
      </div>

      <footer className="sysprompt-modal__footer" aria-label="Prompt statistics">
        <div className="sysprompt-modal__meta-item">
          <span className="sysprompt-modal__meta-value">{characterCount.toLocaleString()}</span>
          <span className="sysprompt-modal__meta-label">Characters</span>
        </div>
        <span className="sysprompt-modal__meta-divider" aria-hidden="true" />
        <div className="sysprompt-modal__meta-item">
          <span className="sysprompt-modal__meta-value">{wordCount.toLocaleString()}</span>
          <span className="sysprompt-modal__meta-label">Words</span>
        </div>
      </footer>
    </ModalShell>
  );
}
