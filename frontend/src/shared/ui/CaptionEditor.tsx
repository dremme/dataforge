import { useCallback, useMemo } from "react";
import type { SaveState } from "@/shared/hooks/useDebouncedSave";
import { classNames } from "@/shared/lib/classNames";
import type { VocabularyEntry } from "@/features/gallery/lib/captionVocabulary";
import { vocabularyCompletion } from "@/shared/lib/codeEditorCompletion";
import { literalMatchHighlight, queryMatchHighlight } from "@/shared/lib/codeEditorQueryHighlight";
import { CodeMirrorEditor, type CodeMirrorEditorProps } from "./CodeMirrorEditor";

export type CaptionEditorVariant = "success" | "warning" | "muted";

export type CaptionEditorProps = Omit<
  CodeMirrorEditorProps,
  "language" | "onBlur" | "extensions"
> & {
  /** Placeholder / empty-state tone from caption status display. */
  variant?: CaptionEditorVariant;
  /** Autosave or explicit save feedback. */
  saveState?: SaveState;
  /** Gallery toolbar search — highlight matching spans in the caption. */
  searchQuery?: string;
  searchRegex?: boolean;
  /** Fixed phrases to highlight the same way, e.g. the wording an issue flags. Memoize it. */
  highlightTerms?: readonly string[];
  /** Words and tags this folder's captions already use. Memoize it. */
  completions?: readonly VocabularyEntry[];
};

const NO_HIGHLIGHT_TERMS: readonly string[] = [];
const NO_COMPLETIONS: readonly VocabularyEntry[] = [];

export function CaptionEditor({
  className,
  variant,
  saveState = "idle",
  searchQuery = "",
  searchRegex = false,
  highlightTerms = NO_HIGHLIGHT_TERMS,
  completions = NO_COMPLETIONS,
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
    () => [
      queryMatchHighlight(searchQuery, searchRegex),
      literalMatchHighlight(highlightTerms),
      ...(completions.length > 0 ? [vocabularyCompletion(completions)] : []),
    ],
    [searchQuery, searchRegex, highlightTerms, completions],
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
