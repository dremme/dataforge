import { useCallback, useEffect, useId, useRef, useState } from "react";
import { previewCaptionReplacements } from "@/features/automation/api/jobs";
import { isAbortError } from "@/shared/api/http";
import type { CaptionReplaceMode, CaptionReplacePreviewSample } from "@/shared/types";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";
import { RadioTileGroup, type RadioTileOption } from "@/shared/ui/RadioTileGroup";

const MODE_OPTIONS: ReadonlyArray<RadioTileOption<CaptionReplaceMode>> = [
  { value: "replace", title: "Replace", description: "Swap matching text in every caption." },
  { value: "prepend", title: "Prepend", description: "Add text to the start of every caption." },
  { value: "append", title: "Append", description: "Add text to the end of every caption." },
];

const PREVIEW_DEBOUNCE_MS = 300;

export interface ReplaceCaptionsSettings {
  mode: CaptionReplaceMode;
  search: string;
  replacement: string;
  useRegex: boolean;
  caseSensitive: boolean;
}

interface ReplaceCaptionsDialogProps {
  folderLabel: string;
  folderPath: string;
  /** Paths the job will be limited to, or undefined for the whole folder. */
  selectedPaths?: string[];
  busy?: boolean;
  onConfirm: (settings: ReplaceCaptionsSettings) => void;
  onCancel: () => void;
}

interface PreviewState {
  matched: number;
  total: number;
  samples: CaptionReplacePreviewSample[];
  error: string | null;
}

export function ReplaceCaptionsDialog({
  folderLabel,
  folderPath,
  selectedPaths,
  busy = false,
  onConfirm,
  onCancel,
}: ReplaceCaptionsDialogProps) {
  const [mode, setMode] = useState<CaptionReplaceMode>("replace");
  const [search, setSearch] = useState("");
  const [replacement, setReplacement] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const replacementId = useId();
  const errorId = useId();

  const isReplace = mode === "replace";

  // The only dialog that talks to the API: the preview has to round-trip through the
  // backend, because Python's regular expressions are not JavaScript's, and a preview
  // built from a different engine would promise edits the job does not make.
  useEffect(() => {
    if (isReplace ? !search : !replacement.trim()) {
      setPreview(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      previewCaptionReplacements(
        folderPath,
        {
          mode,
          search,
          replacement,
          use_regex: useRegex,
          case_sensitive: caseSensitive,
          paths: selectedPaths,
        },
        controller.signal,
      )
        .then((response) => {
          setPreview({
            matched: response.matched,
            total: response.total,
            samples: response.samples,
            error: response.error ?? null,
          });
        })
        .catch((cause: unknown) => {
          if (isAbortError(cause)) return;
          setPreview(null);
        });
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [caseSensitive, folderPath, isReplace, mode, replacement, search, selectedPaths, useRegex]);

  const handleConfirm = useCallback(() => {
    if (busy) return;

    if (isReplace && !search) {
      setError("Enter the text to search for.");
      return;
    }
    if (!isReplace && !replacement.trim()) {
      setError("Enter the text to add.");
      return;
    }
    if (preview?.error) {
      setError(preview.error);
      return;
    }

    setError(null);
    onConfirm({ mode, search, replacement, useRegex, caseSensitive });
  }, [busy, caseSensitive, isReplace, mode, onConfirm, preview, replacement, search, useRegex]);

  const clearError = useCallback(() => setError(null), []);

  return (
    <Dialog
      title="Find and replace in captions?"
      description={
        <>
          Edit the captions of media in <strong>{folderLabel}</strong>. Files whose caption does not
          match are left untouched.
        </>
      }
      panelClassName="replace-captions-dialog"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onCancel}
      initialFocusRef={searchRef}
      describedById={error ? errorId : undefined}
      footer={
        <DialogActions
          confirmLabel="Replace"
          busyLabel="Starting..."
          busy={busy}
          onConfirm={handleConfirm}
          onCancel={onCancel}
        />
      }
    >
      <RadioTileGroup
        value={mode}
        options={MODE_OPTIONS}
        label="Edit"
        name="replace-captions-mode"
        groupLabel="Caption edit"
        disabled={busy}
        onChange={(value) => {
          setMode(value);
          clearError();
        }}
      />

      <div className="dialog__field">
        <label htmlFor={searchId} className="dialog__label">
          Search for
        </label>
        <input
          ref={searchRef}
          id={searchId}
          type="text"
          className="dialog__input"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            clearError();
          }}
          placeholder="e.g. dog"
          spellCheck={false}
          autoComplete="off"
          // Kept visible rather than hidden in prepend/append mode, so the dialog
          // says the term is unused instead of silently rearranging itself.
          disabled={busy || !isReplace}
        />
      </div>

      <div className="dialog__field">
        <label htmlFor={replacementId} className="dialog__label">
          {isReplace ? "Replace with" : "Text to add"}
        </label>
        <input
          id={replacementId}
          type="text"
          className="dialog__input"
          value={replacement}
          onChange={(event) => {
            setReplacement(event.target.value);
            clearError();
          }}
          placeholder={isReplace ? "e.g. cat" : "e.g. sks person, "}
          spellCheck={false}
          autoComplete="off"
          disabled={busy}
        />
      </div>

      <label className="dialog__checkbox">
        <input
          type="checkbox"
          className="dialog__checkbox-input"
          checked={useRegex}
          onChange={(event) => {
            setUseRegex(event.target.checked);
            clearError();
          }}
          disabled={busy || !isReplace}
        />
        <span className="dialog__checkbox-box" aria-hidden="true" />
        <span className="dialog__checkbox-label">Regular expression</span>
      </label>

      <label className="dialog__checkbox">
        <input
          type="checkbox"
          className="dialog__checkbox-input"
          checked={caseSensitive}
          onChange={(event) => {
            setCaseSensitive(event.target.checked);
            clearError();
          }}
          disabled={busy}
        />
        <span className="dialog__checkbox-box" aria-hidden="true" />
        <span className="dialog__checkbox-label">Match case</span>
      </label>

      <ReplacePreview preview={preview} />

      {error && (
        <p id={errorId} className="dialog__error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

function ReplacePreview({ preview }: { preview: PreviewState | null }) {
  if (!preview) return null;

  if (preview.error) {
    return (
      <p className="dialog__error" role="status">
        {preview.error}
      </p>
    );
  }

  return (
    <div className="dialog__field replace-captions-dialog__preview">
      <p className="dialog__hint">
        {preview.matched === 0
          ? `No captions match — nothing would change in ${preview.total} files.`
          : `${preview.matched} of ${preview.total} captions would change.`}
      </p>
      {preview.samples.map((sample) => (
        <p key={sample.name} className="dialog__hint">
          <code>{sample.before}</code> → <code>{sample.after}</code>
        </p>
      ))}
    </div>
  );
}
