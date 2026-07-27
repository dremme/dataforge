import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

export type CodeEditorLanguage = "markdown" | "json";

const mkpText = "#d6d6dd";
const mkpBright = "#fcfcfa";
const mkpYellow = "#ffd866";
const mkpOrange = "#fc9867";
const mkpPink = "#ff6188";
const mkpGreen = "#a9dc76";
const mkpCyan = "#78dce8";
const mkpPurple = "#ab9df2";
const mkpMuted = "#939293";
const mkpSelection = "rgba(120, 220, 232, 0.28)";

const baseEditorTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--bg-media)",
      color: mkpText,
      height: "100%",
    },
    "&.cm-focused": {
      outline: "none",
    },
    ".cm-scroller": {
      fontFamily: "Consolas, ui-monospace, monospace",
      fontSize: "var(--text-sm)",
      fontWeight: "var(--font-normal)",
      lineHeight: "var(--leading-relaxed)",
      overflowY: "auto",
    },
    ".cm-content": {
      caretColor: mkpBright,
    },
    ".cm-gutters": {
      backgroundColor: "var(--bg-media)",
      borderRight: "1px solid rgba(255, 255, 255, 0.06)",
      color: mkpMuted,
      fontFamily: "Consolas, ui-monospace, monospace",
      fontSize: "var(--text-sm)",
      fontWeight: "var(--font-normal)",
      lineHeight: "var(--leading-relaxed)",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      textAlign: "right",
      fontVariantNumeric: "tabular-nums",
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: mkpSelection,
    },
    "&.cm-focused .cm-cursor": {
      borderLeftColor: mkpBright,
    },
    ".cm-placeholder": {
      color: mkpMuted,
      fontStyle: "italic",
      opacity: "0.9",
    },
  },
  { dark: true },
);

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

/** Stable per-language themes so react-codemirror does not reconfigure on every render. */
const themes: Record<CodeEditorLanguage, Extension[]> = {
  markdown: [baseEditorTheme, syntaxHighlighting(markdownHighlightStyle)],
  json: [baseEditorTheme, syntaxHighlighting(jsonHighlightStyle)],
};

export function getCodeEditorTheme(language: CodeEditorLanguage): Extension[] {
  return themes[language];
}
