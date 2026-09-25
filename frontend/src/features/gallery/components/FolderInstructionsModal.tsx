import { useCallback, useId, useRef, useState, type KeyboardEvent } from "react";
import { saveInstructionFile, type InstructionKind } from "@/shared/api/folderInstructions";
import { formatApiError } from "@/shared/api/http";
import { CAPTION_RULES_FILENAME, SYSPROMPT_FILENAME } from "@/shared/constants";
import { useFolderInstructions } from "@/shared/hooks/useFolderInstructions";
import { ModalShell } from "@/shared/ui/ModalShell";
import { iconCopy, iconFilePlus, iconLoader2, iconX } from "@/shared/icons";
import type { InstructionFileResponse } from "@/shared/types";
import { classNames } from "@/shared/lib/classNames";
import { formatCount, estimateTokens } from "@/shared/lib/format";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { DialogButton } from "@/shared/ui/Dialog";
import { Icon } from "@/shared/ui/Icon";
import { MarkdownEditor } from "@/shared/ui/MarkdownEditor";
import { YamlEditor } from "@/shared/ui/YamlEditor";

interface InstructionDocument {
  label: string;
  filename: string;
  placeholder: string;
}

const DOCUMENTS: Record<InstructionKind, InstructionDocument> = {
  sysprompt: {
    label: "System prompt",
    filename: SYSPROMPT_FILENAME,
    placeholder: "Write a system prompt for this folder...",
  },
  caption_rules: {
    label: "Caption rules",
    filename: CAPTION_RULES_FILENAME,
    placeholder: "No caption rules for this folder. Write YAML here, or start from the template.",
  },
};

const KINDS = Object.keys(DOCUMENTS) as InstructionKind[];

/** Rules first on save: they are the document the backend can refuse. */
const SAVE_ORDER: readonly InstructionKind[] = ["caption_rules", "sysprompt"];

const TAB_KEY_TARGETS: Record<string, (index: number) => number> = {
  ArrowRight: (index) => index + 1,
  ArrowLeft: (index) => index - 1,
  Home: () => 0,
  End: () => KINDS.length - 1,
};

const NO_DRAFTS: Record<InstructionKind, string | null> = { sysprompt: null, caption_rules: null };

interface FolderInstructionsModalProps {
  folderPath: string;
  initialTab?: InstructionKind;
  onClose: () => void;
  onSaved: (kind: InstructionKind, saved: InstructionFileResponse) => void;
}

function FileSource({ file, filename }: { file: InstructionFileResponse; filename: string }) {
  const parent = file.parent_folder !== null && (
    <strong title={file.parent_folder}>{file.parent_relative_path}</strong>
  );

  if (file.has_file && parent) {
    return (
      <>
        This folder's {filename}, replacing {parent}
      </>
    );
  }
  if (file.has_file) return <>This folder's {filename}</>;
  if (parent) return <>Uses {parent} until this folder has its own</>;
  return <>No {filename} yet; saving creates one here</>;
}

function lineCount(text: string): number {
  return text.length === 0 ? 0 : text.replace(/\n$/, "").split("\n").length;
}

export function FolderInstructionsModal({
  folderPath,
  initialTab = "sysprompt",
  onClose,
  onSaved,
}: FolderInstructionsModalProps) {
  const [tab, setTab] = useState<InstructionKind>(initialTab);
  const { state, instructions, setFile } = useFolderInstructions(folderPath);
  // Null until edited, so the text shown follows whatever was last loaded or saved.
  const [drafts, setDrafts] = useState(NO_DRAFTS);
  const [errors, setErrors] = useState<Record<InstructionKind, string | null>>(NO_DRAFTS);
  const [saving, setSaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const idPrefix = useId();
  const tabRefs = useRef<Partial<Record<InstructionKind, HTMLButtonElement | null>>>({});

  const textOf = (kind: InstructionKind) => drafts[kind] ?? instructions?.[kind].text ?? "";
  const editedKinds = KINDS.filter(
    (kind) => instructions !== null && textOf(kind) !== instructions[kind].text,
  );
  const edited = editedKinds.length > 0;

  const setDraft = useCallback((kind: InstructionKind, value: string | null) => {
    setDrafts((current) => ({ ...current, [kind]: value }));
    setErrors((current) => ({ ...current, [kind]: null }));
  }, []);

  const handleSave = async () => {
    if (saving || !edited) return;

    setSaving(true);
    try {
      for (const kind of SAVE_ORDER.filter((entry) => editedKinds.includes(entry))) {
        try {
          const saved = await saveInstructionFile(kind, folderPath, textOf(kind));
          setFile(kind, saved);
          setDraft(kind, null);
          onSaved(kind, saved);
        } catch (error) {
          setErrors((current) => ({ ...current, [kind]: formatApiError(error) }));
          setTab(kind);
          return;
        }
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  // The one exit path: close button, Escape and backdrop all land here.
  const requestClose = () => {
    if (saving) return;
    if (edited) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = TAB_KEY_TARGETS[event.key];
    if (!target) return;

    event.preventDefault();
    const next = KINDS[(target(KINDS.indexOf(tab)) + KINDS.length) % KINDS.length];
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  const panelId = (kind: InstructionKind) => `${idPrefix}-${kind}-panel`;
  const tabId = (kind: InstructionKind) => `${idPrefix}-${kind}-tab`;
  const text = textOf(tab);
  const unsavedNames = editedKinds.map((kind) => DOCUMENTS[kind].label.toLowerCase()).join(" and ");

  const renderToolbarAside = (kind: InstructionKind) => {
    if (!instructions) return null;

    const file = instructions[kind];
    const fill =
      file.parent_folder !== null
        ? { label: "Copy from parent", icon: iconCopy, text: file.parent_text }
        : kind === "caption_rules"
          ? { label: "Use template", icon: iconFilePlus, text: instructions.caption_rules_template }
          : null;

    return (
      <div className="folder-instructions-modal__source">
        <span className="folder-instructions-modal__source-text">
          <FileSource file={file} filename={DOCUMENTS[kind].filename} />
        </span>
        {fill && textOf(kind).trim() === "" && (
          <button
            type="button"
            className="folder-instructions-modal__source-action"
            disabled={saving}
            onClick={() => setDraft(kind, fill.text)}
          >
            <Icon icon={fill.icon} className="folder-instructions-modal__source-action-icon" />
            {fill.label}
          </button>
        )}
      </div>
    );
  };

  const renderEditor = (kind: InstructionKind) => {
    const file = instructions?.[kind];
    if (!file) return null;

    const details = DOCUMENTS[kind];
    const editorProps = {
      id: `${kind}-editor`,
      className: classNames("code-editor--muted", errors[kind] && "code-editor--error"),
      value: textOf(kind),
      placeholder:
        file.parent_relative_path === null
          ? details.placeholder
          : `This folder uses ${file.parent_relative_path}. Write here to replace it for this folder only.`,
      "aria-label": details.label,
      "aria-invalid": errors[kind] !== null,
      editable: !saving,
      onChange: (value: string) => setDraft(kind, value),
    };

    if (kind === "sysprompt") {
      return <MarkdownEditor {...editorProps} toolbarAside={renderToolbarAside(kind)} />;
    }
    return (
      <div className="code-editor-wrapper">
        <div className="code-editor-wrapper__toolbar">{renderToolbarAside(kind)}</div>
        <YamlEditor {...editorProps} />
      </div>
    );
  };

  return (
    <ModalShell
      block="folder-instructions-modal"
      label="Folder instructions"
      onClose={requestClose}
      busy={saving}
      suspended={discardOpen}
      escape="editor"
      // useGalleryOverlays holds the session lock; measuring depth here would drop the blur.
      nested={false}
    >
      <header className="folder-instructions-modal__header">
        <div className="folder-instructions-modal__header-text">
          <div className="folder-instructions-modal__header-copy">
            <h2 className="folder-instructions-modal__title">Folder instructions</h2>
            <p className="folder-instructions-modal__subtitle">
              The <strong>system prompt</strong> tells the model how to caption, and markdown helps
              it follow. <strong>Caption rules</strong> are checked without a model. Both are saved
              to this folder only and cover subfolders without their own; saving one empty removes
              its file.
            </p>
          </div>
        </div>
        <div className="folder-instructions-modal__header-actions">
          <button
            type="button"
            className="folder-instructions-modal__close"
            onClick={requestClose}
            disabled={saving}
            aria-label="Close"
          >
            <Icon icon={iconX} />
          </button>
        </div>
      </header>

      <div
        role="tablist"
        aria-label="Folder instructions"
        className="folder-instructions-modal__tabs"
        onKeyDown={handleTabKeyDown}
      >
        {KINDS.map((kind) => {
          const selected = kind === tab;
          return (
            <button
              key={kind}
              ref={(element) => {
                tabRefs.current[kind] = element;
              }}
              type="button"
              role="tab"
              id={tabId(kind)}
              aria-selected={selected}
              aria-controls={panelId(kind)}
              tabIndex={selected ? 0 : -1}
              className={classNames(
                "folder-instructions-modal__tab",
                selected && "folder-instructions-modal__tab--active",
              )}
              onClick={() => setTab(kind)}
            >
              {DOCUMENTS[kind].label}
              {editedKinds.includes(kind) && (
                <span className="folder-instructions-modal__tab-dot" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>

      {KINDS.map((kind) => (
        <div
          key={kind}
          role="tabpanel"
          id={panelId(kind)}
          aria-labelledby={tabId(kind)}
          className="folder-instructions-modal__body"
          hidden={tab !== kind}
        >
          {state.status === "loading" && (
            <p className="folder-instructions-modal__status" role="status">
              <Icon icon={iconLoader2} spin className="folder-instructions-modal__status-icon" />
              Loading folder instructions...
            </p>
          )}

          {state.status === "error" && (
            <p
              className="folder-instructions-modal__status folder-instructions-modal__status--error"
              role="alert"
            >
              Could not load the folder instructions. {state.message}
            </p>
          )}

          {renderEditor(kind)}
        </div>
      ))}

      {errors[tab] && (
        <p className="folder-instructions-modal__error" role="alert">
          {errors[tab]}
        </p>
      )}

      <footer className="folder-instructions-modal__footer">
        <div
          className="folder-instructions-modal__meta"
          aria-label={tab === "sysprompt" ? "Prompt statistics" : "Rule statistics"}
        >
          <div className="folder-instructions-modal__meta-value">
            {formatCount(text.length)} characters
          </div>
          <span className="folder-instructions-modal__meta-divider" aria-hidden="true" />
          {tab === "sysprompt" ? (
            <div
              className="folder-instructions-modal__meta-value"
              title="Estimated from text length; the exact count depends on the model"
            >
              ~{formatCount(estimateTokens(text))} tokens
            </div>
          ) : (
            <div className="folder-instructions-modal__meta-value">
              {formatCount(lineCount(text))} lines
            </div>
          )}
        </div>

        <DialogButton
          label="Reset"
          variant="secondary"
          disabled={saving || !editedKinds.includes(tab)}
          onClick={() => setDraft(tab, null)}
        />
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
          description={`Your changes to the ${unsavedNames} will be lost. This cannot be undone.`}
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
