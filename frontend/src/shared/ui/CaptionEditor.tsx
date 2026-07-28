import { useCallback, useMemo } from "react";
import { classNames } from "@/shared/lib/classNames";
import { queryMatchHighlight } from "@/shared/lib/codeEditorQueryHighlight";
import { CodeMirrorEditor, type CodeMirrorEditorProps } from "./CodeMirrorEditor";

export type CaptionEditorVariant = "success" | "warning" | "muted";
export type CaptionEditorSaveState = "idle" | "saving" | "saved" | "error";

export type CaptionEditorProps = Omit<
  CodeMirrorEditorProps,
  "language" | "onBlur" | "extensions"
> & {
  /** Placeholder / empty-state tone from caption status display. */
  variant?: CaptionEditorVariant;
  /** Autosave or explicit save feedback. */
  saveState?: CaptionEditorSaveState;
  /** Gallery toolbar search — highlight matching spans in the caption. */
  searchQuery?: string;
  searchRegex?: boolean;
};

/**
 * Plaintext CodeMirror field for gallery captions.
 * Chrome (colors, density, focus/saved/error) lives in `.code-editor--caption`.
 */
export function CaptionEditor({
  className,
  variant,
  saveState = "idle",
  searchQuery = "",
  searchRegex = false,
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

  const extensions = useMemo(
    () => [queryMatchHighlight(searchQuery, searchRegex)],
    [searchQuery, searchRegex],
  );

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
      extensions={extensions}
      {...props}
    />
  );
}
