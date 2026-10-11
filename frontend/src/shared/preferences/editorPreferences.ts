import { createContext, useContext } from "react";
import { readStoredJson, writeStoredJson } from "@/shared/lib/storage";
import type { EditorSettings, SpellcheckLanguage } from "@/shared/types";

export interface EditorOptions {
  lineWrap: boolean;
  lineNumbers: boolean;
  /** Caption editor only. */
  captionSpellcheck: boolean;
  captionSpellcheckLanguage: SpellcheckLanguage;
  /** Caption editor only; Ctrl+Space still asks for suggestions when off. */
  captionSuggestions: boolean;
}

export const SPELLCHECK_LANGUAGES = [
  "en-US",
  "en-GB",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "pl",
  "sv",
  "da",
  "nb",
  "fi",
  "cs",
  "ru",
  "uk",
  "tr",
] as const satisfies SpellcheckLanguage[];

export const DEFAULT_EDITOR_OPTIONS: EditorOptions = {
  lineWrap: true,
  lineNumbers: true,
  captionSpellcheck: true,
  captionSpellcheckLanguage: "en-US",
  captionSuggestions: true,
};

// Local mirror of the saved UI setting, so an editor opened before the server answers matches.
const EDITOR_OPTIONS_CACHE_KEY = "editor-options";

type EditorFlag = "lineWrap" | "lineNumbers" | "captionSpellcheck" | "captionSuggestions";

function parseEditorOptions(value: unknown): EditorOptions | null {
  if (!value || typeof value !== "object") return null;

  const parsed = value as Record<string, unknown>;
  const flag = (key: EditorFlag) => {
    const stored = parsed[key];
    return typeof stored === "boolean" ? stored : DEFAULT_EDITOR_OPTIONS[key];
  };
  return {
    lineWrap: flag("lineWrap"),
    lineNumbers: flag("lineNumbers"),
    captionSpellcheck: flag("captionSpellcheck"),
    captionSpellcheckLanguage:
      SPELLCHECK_LANGUAGES.find((language) => language === parsed.captionSpellcheckLanguage) ??
      DEFAULT_EDITOR_OPTIONS.captionSpellcheckLanguage,
    captionSuggestions: flag("captionSuggestions"),
  };
}

export function readEditorOptions(): EditorOptions {
  return readStoredJson(EDITOR_OPTIONS_CACHE_KEY, parseEditorOptions, DEFAULT_EDITOR_OPTIONS);
}

export function cacheEditorOptions(options: EditorOptions): void {
  writeStoredJson(EDITOR_OPTIONS_CACHE_KEY, options);
}

/** Runs the server copy through the same parser as the local mirror. */
export function editorOptionsFromWire(settings: EditorSettings): EditorOptions {
  return (
    parseEditorOptions({
      lineWrap: settings.line_wrap,
      lineNumbers: settings.line_numbers,
      captionSpellcheck: settings.caption_spellcheck,
      captionSpellcheckLanguage: settings.caption_spellcheck_language,
      captionSuggestions: settings.caption_suggestions,
    }) ?? DEFAULT_EDITOR_OPTIONS
  );
}

export function editorOptionsToWire(options: EditorOptions): EditorSettings {
  return {
    line_wrap: options.lineWrap,
    line_numbers: options.lineNumbers,
    caption_spellcheck: options.captionSpellcheck,
    caption_spellcheck_language: options.captionSpellcheckLanguage,
    caption_suggestions: options.captionSuggestions,
  };
}

export function sameEditorOptions(a: EditorOptions, b: EditorOptions): boolean {
  return (Object.keys(a) as (keyof EditorOptions)[]).every((key) => a[key] === b[key]);
}

/**
 * The app root provides the saved options. Editors rendered without it, as in isolated tests,
 * fall back to the defaults.
 */
export const EditorOptionsContext = createContext<EditorOptions>(DEFAULT_EDITOR_OPTIONS);

export function useEditorOptions(): EditorOptions {
  return useContext(EditorOptionsContext);
}
