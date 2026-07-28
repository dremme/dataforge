import { useCallback } from "react";
import { classNames } from "@/shared/lib/classNames";
import { CodeMirrorEditor, type CodeMirrorEditorProps } from "./CodeMirrorEditor";

export type CaptionEditorVariant = "success" | "warning" | "muted";
export type CaptionEditorSaveState = "idle" | "saving" | "saved" | "error";

export type CaptionEditorProps = Omit<CodeMirrorEditorProps, "language" | "onBlur"> & {
  /** Placeholder / empty-state tone from caption status display. */
  variant?: CaptionEditorVariant;
  /** Autosave or explicit save feedback. */
  saveState?: CaptionEditorSaveState;
};

/**
 * Plaintext CodeMirror field for gallery captions.
 * Chrome (colors, density, focus/saved/error) lives in `.code-editor--caption`.
 */
export function CaptionEditor({
  className,
  variant,
  saveState = "idle",
  value,
  onChange,
  ...props
}: CaptionEditorProps) {
  const handleBlur = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed !== value) {
      onChange(trimmed);
    }
  }, [onChange, value]);

  return (
    <CodeMirrorEditor
      language="plaintext"
      className={classNames(
        "code-editor--caption",
        variant && `code-editor--${variant}`,
        saveState !== "idle" && `code-editor--${saveState}`,
        className,
      )}
      value={value}
      onChange={onChange}
      onBlur={handleBlur}
      {...props}
    />
  );
}
