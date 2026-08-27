import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { previewCaptionReplacements } from "@/features/automation/api/jobs";
import { diffCaption } from "@/features/automation/lib/captionDiff";
import { isAbortError } from "@/shared/api/http";
import { classNames } from "@/shared/lib/classNames";
import type { CaptionReplaceMode, CaptionReplacePreviewSample } from "@/shared/types";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";
import type { JobSettingsByType } from "@/features/automation/preferences/automationPreferences";
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
  scope: DialogScopeInfo;
  initialSettings: JobSettingsByType["replace_captions"];
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
  scope,
  initialSettings,
  folderPath,
  selectedPaths,
  busy = false,
  onConfirm,
  onCancel,
}: ReplaceCaptionsDialogProps) {
  const [mode, setMode] = useState<CaptionReplaceMode>(initialSettings.mode);
  const [search, setSearch] = useState(initialSettings.search);
  const [replacement, setReplacement] = useState(initialSettings.replacement);
  const [useRegex, setUseRegex] = useState(initialSettings.use_regex);
  const [caseSensitive, setCaseSensitive] = useState(initialSettings.case_sensitive);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  // The previous answer stays on screen while a new one is in flight, dimmed, so
  // typing neither blanks the panel nor lets stale counts pass for fresh ones.
  const [previewPending, setPreviewPending] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const replacementId = useId();
  const errorId = useId();

  const isReplace = mode === "replace";

  // Preview must use Python regex via the API; a JS engine would promise edits the job does not make.
  useEffect(() => {
    if (isReplace ? !search : !replacement.trim()) {
      setPreview(null);
      setPreviewPending(false);
      return;
    }

    setPreviewPending(true);
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
          setPreviewPending(false);
        })
        .catch((cause: unknown) => {
          if (isAbortError(cause)) return;
          setPreview(null);
          setPreviewPending(false);
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

  // Explains whichever control the current mode has just taken away or handed over,
  // so a greyed-out field is never left without a reason.
  let hint: ReactNode = null;
  if (!isReplace) {
    hint = "Prepend and append add the text to every caption; there is nothing to search for.";
  } else if (useRegex) {
    hint = (
      <>
        Refer to capture groups in the replacement as <code>\1</code>, <code>\2</code>.
      </>
    );
  }

  return (
    <Dialog
      scope={scope}
      title="Find and replace in captions?"
      description={
        <>Edits the captions in place. Files whose caption does not match are left untouched.</>
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
      {/* Header and actions stay put while the fields scroll, so a short viewport
          never pushes the Replace button out of reach. */}
      <div className="replace-captions-dialog__body">
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

        <div className="dialog__field replace-captions-dialog__terms">
          <div className="replace-captions-dialog__term">
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
              placeholder={isReplace ? "e.g. dog" : "Not used in this mode"}
              spellCheck={false}
              autoComplete="off"
              // Kept visible rather than hidden in prepend/append mode, so the dialog
              // says the term is unused instead of silently rearranging itself.
              disabled={busy || !isReplace}
            />
          </div>

          <div className="replace-captions-dialog__term">
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
        </div>

        <div className="dialog__field replace-captions-dialog__toggles">
          <label className="dialog__checkbox replace-captions-dialog__toggle">
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

          <label className="dialog__checkbox replace-captions-dialog__toggle">
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
        </div>

        {/* One hint slot, so toggling an option cannot stack two lines of advice. */}
        {hint && <p className="dialog__hint">{hint}</p>}

        <ReplacePreview preview={preview} pending={previewPending} />

        {error && (
          <p id={errorId} className="dialog__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function ReplacePreview({ preview, pending }: { preview: PreviewState | null; pending: boolean }) {
  const hidden = preview?.samples.length ? preview.matched - preview.samples.length : 0;

  return (
    <div className="dialog__field replace-captions-dialog__preview-field">
      <div className="dialog__label">Preview</div>
      <div
        className={classNames(
          "replace-captions-dialog__preview",
          preview?.error && "replace-captions-dialog__preview--error",
          pending && "replace-captions-dialog__preview--pending",
        )}
        // One live region for the whole panel: the counts and the samples always
        // change together, and announcing them separately would interleave them.
        role="status"
        aria-busy={pending || undefined}
      >
        <ReplacePreviewBody preview={preview} hidden={hidden} />
      </div>
    </div>
  );
}

function ReplacePreviewBody({ preview, hidden }: { preview: PreviewState | null; hidden: number }) {
  if (preview?.error) {
    return <p className="replace-captions-dialog__preview-summary">{preview.error}</p>;
  }

  if (!preview) {
    return (
      <p className="replace-captions-dialog__preview-empty">
        Fill in the fields above to preview the change.
      </p>
    );
  }

  return (
    <>
      <p className="replace-captions-dialog__preview-summary">
        {preview.matched === 0 ? (
          <>No captions match — nothing would change in {preview.total} files.</>
        ) : (
          <>
            <strong>{preview.matched}</strong> of {preview.total} captions would change.
          </>
        )}
      </p>

      {preview.samples.length > 0 && (
        <ul className="replace-captions-dialog__samples">
          {preview.samples.map((sample) => (
            <ReplaceSample key={sample.name} sample={sample} />
          ))}
          {hidden > 0 && (
            <li className="replace-captions-dialog__samples-more">and {hidden} more</li>
          )}
        </ul>
      )}
    </>
  );
}

function ReplaceSample({ sample }: { sample: CaptionReplacePreviewSample }) {
  const { prefix, removed, added, suffix } = diffCaption(sample.before, sample.after);

  return (
    <li className="replace-captions-dialog__sample">
      <span className="replace-captions-dialog__sample-name" title={sample.name}>
        {sample.name}
      </span>
      <p className="replace-captions-dialog__sample-text">
        {prefix}
        {removed && <del className="replace-captions-dialog__removed">{removed}</del>}
        {added && <ins className="replace-captions-dialog__added">{added}</ins>}
        {suffix}
      </p>
    </li>
  );
}
