import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags } from "@lezer/highlight";

export type CodeEditorLanguage = "markdown" | "json" | "yaml" | "plaintext";

const mkpBright = "#fcfcfa";
const mkpYellow = "#ffd866";
const mkpOrange = "#fc9867";
const mkpPink = "#ff6188";
const mkpGreen = "#a9dc76";
const mkpCyan = "#78dce8";
const mkpPurple = "#ab9df2";
const mkpMuted = "#939293";

/**
 * Editor chrome (background, gutters, selection, fonts) lives in `_code-editor.scss`.
 * Keep highlight extensions stable so react-codemirror does not reconfigure every render.
 */
const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: mkpYellow, fontWeight: "bold" },
  { tag: tags.strong, color: mkpBright, fontWeight: "bold" },
  { tag: tags.emphasis, color: mkpGreen, fontStyle: "italic" },
  { tag: tags.strikethrough, color: mkpMuted, textDecoration: "line-through" },
  { tag: tags.monospace, color: mkpPink },
  { tag: tags.url, color: mkpCyan, textDecoration: "underline" },
  { tag: tags.link, color: mkpCyan },
  { tag: tags.quote, color: mkpBright, fontStyle: "italic" },
  { tag: tags.contentSeparator, color: mkpPurple },
  { tag: tags.processingInstruction, color: mkpPurple },
  { tag: tags.keyword, color: mkpPurple },
  { tag: tags.comment, color: mkpMuted },
  { tag: tags.punctuation, color: mkpOrange },
]);

const jsonHighlightStyle = HighlightStyle.define([
  { tag: tags.propertyName, color: mkpCyan },
  { tag: tags.string, color: mkpGreen },
  { tag: tags.number, color: mkpOrange },
  { tag: tags.bool, color: mkpPurple },
  { tag: tags.null, color: mkpPink },
  { tag: tags.brace, color: mkpYellow },
  { tag: tags.squareBracket, color: mkpYellow },
  { tag: tags.separator, color: mkpMuted },
  { tag: tags.punctuation, color: mkpMuted },
  { tag: tags.comment, color: mkpMuted, fontStyle: "italic" },
  { tag: tags.invalid, color: mkpPink },
]);

// YAML is read far more than it is written here - a training template is mostly keys
// and numbers - so keys stay cool and values warm, and comments recede.
const yamlHighlightStyle = HighlightStyle.define([
  { tag: tags.propertyName, color: mkpCyan },
  { tag: tags.string, color: mkpGreen },
  { tag: tags.number, color: mkpOrange },
  { tag: tags.bool, color: mkpPurple },
  { tag: tags.null, color: mkpPink },
  { tag: tags.keyword, color: mkpPurple },
  { tag: tags.atom, color: mkpPurple },
  { tag: tags.meta, color: mkpMuted },
  { tag: tags.separator, color: mkpMuted },
  { tag: tags.punctuation, color: mkpMuted },
  { tag: tags.comment, color: mkpMuted, fontStyle: "italic" },
  { tag: tags.invalid, color: mkpPink },
]);

const highlightByLanguage: Partial<Record<CodeEditorLanguage, Extension>> = {
  markdown: syntaxHighlighting(markdownHighlightStyle),
  json: syntaxHighlighting(jsonHighlightStyle),
  yaml: syntaxHighlighting(yamlHighlightStyle),
};

/** Stable syntax-highlight extension for the given language (chrome is SCSS). */
export function getCodeEditorHighlightExtension(language: CodeEditorLanguage): Extension {
  return highlightByLanguage[language] ?? [];
}
