import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getGalleryItemCaptionDisplay } from "@/features/gallery/lib/captionStatus";
import { saveSysPrompt } from "@/features/gallery/api/captions";
import { useDebouncedSave } from "@/shared/hooks/useDebouncedSave";
import { useFocusTrap } from "@/shared/hooks/useFocusTrap";
import { iconX } from "@/shared/icons";
import type { GalleryItem, SysPromptSaveResponse } from "@/shared/types";
import { closeCodeEditorSearchPanel } from "@/shared/lib/codeEditorSearch";
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
  useFocusTrap(panelRef, true);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Prefer closing the code-editor find panel over the dialog.
      if (closeCodeEditorSearchPanel(panelRef.current)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.defaultPrevented) return;
      flushPendingSave();
      onClose();
    };

    window.addEventListener("keydown", handleKey, true);
    return () => {
      window.removeEventListener("keydown", handleKey, true);
    };
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

  const close = () => {
    flushPendingSave();
    onClose();
  };

  return createPortal(
    <div
      ref={panelRef}
      className="sysprompt-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Edit system prompt"
    >
      <button
        type="button"
        className="sysprompt-modal__backdrop"
        onClick={close}
        aria-label="Close"
        tabIndex={-1}
      />
      <div className="sysprompt-modal__panel">
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
            className={[
              `code-editor--${captionDisplay.variant}`,
              saveState !== "idle" && `code-editor--${saveState}`,
            ]
              .filter(Boolean)
              .join(" ")}
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
      </div>
    </div>,
    document.body,
  );
}
