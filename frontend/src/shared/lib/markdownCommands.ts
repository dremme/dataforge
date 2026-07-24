import type { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

interface MarkdownCommands {
  bold: (view: EditorView) => void;
  italic: (view: EditorView) => void;
  strikethrough: (view: EditorView) => void;
  heading: (view: EditorView, level: 1 | 2 | 3) => void;
  quote: (view: EditorView) => void;
  code: (view: EditorView) => void;
  unorderedList: (view: EditorView) => void;
  orderedList: (view: EditorView) => void;
  link: (view: EditorView) => void;
  removeFormatting: (view: EditorView) => void;
}

function wrapSelection(view: EditorView, before: string, after: string = before) {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    const selected = state.doc.sliceString(range.from, range.to);
    const newText = before + selected + after;

    return {
      changes: { from: range.from, to: range.to, insert: newText },
      range: EditorSelection.range(
        range.from + before.length,
        range.from + before.length + selected.length,
      ),
    };
  });

  view.dispatch(changes);
  view.focus();
}

function insertAtLineStart(view: EditorView, prefix: string) {
  const { state, dispatch } = view;
  const { doc } = state;

  const changes = state.changeByRange((range) => {
    // Always expand to full lines that the range intersects
    const startLine = doc.lineAt(range.from);
    const endLine = doc.lineAt(range.to);

    const from = startLine.from;
    const to = endLine.to;

    // Get the full text of all affected lines
    const text = doc.sliceString(from, to);
    const lines = text.split("\n");

    // Prefix every line (preserving original behavior of trimStart + space)
    const newLines = lines.map((line) => `${prefix}${line.trimStart()}`);
    const newText = newLines.join("\n");

    // Determine new selection behavior
    let newRange;
    if (range.empty) {
      newRange = EditorSelection.cursor(range.from + prefix.length);
    } else {
      newRange = EditorSelection.range(from, from + newText.length);
    }

    return {
      changes: { from, to, insert: newText },
      range: newRange,
    };
  });

  dispatch(changes);
  view.focus();
}

export const markdownCommands: MarkdownCommands = {
  bold: (view: EditorView) => wrapSelection(view, "**"),
  italic: (view: EditorView) => wrapSelection(view, "*"),
  strikethrough: (view: EditorView) => wrapSelection(view, "~~"),
  heading: (view: EditorView, level: 1 | 2 | 3) => insertAtLineStart(view, `${"#".repeat(level)} `),
  quote: (view: EditorView) => insertAtLineStart(view, "> "),
  code: (view: EditorView) => wrapSelection(view, "`"),
  unorderedList: (view: EditorView) => insertAtLineStart(view, "- "),
  orderedList: (view: EditorView) => insertAtLineStart(view, "1. "),
  link: (view: EditorView) => {
    const url = window.prompt("Enter URL:");
    if (!url) return;

    const { state } = view;
    const changes = state.changeByRange((range) => {
      const selected = state.doc.sliceString(range.from, range.to) || "link text";
      const newText = `[${selected}](${url})`;

      return {
        changes: { from: range.from, to: range.to, insert: newText },
        range: EditorSelection.range(range.from + 1, range.from + 1 + selected.length),
      };
    });

    view.dispatch(changes);
    view.focus();
  },
  removeFormatting: (view: EditorView) => {
    const { state, dispatch } = view;

    const changes = state.changeByRange((range) => {
      let from = range.from;
      let to = range.to;

      // If nothing is selected, operate on the current line (common UX)
      if (from === to) {
        const line = state.doc.lineAt(from);
        from = line.from;
        to = line.to;
      }

      let text = state.doc.sliceString(from, to);

      // === 1. Remove block-level formatting (per line) ===
      const lines = text.split("\n");
      const cleanedLines = lines.map((line) => {
        // Remove heading markers (#, ##, ###, etc.)
        line = line.replace(/^#{1,6}\s+/, "");
        // Remove unordered list markers (-, *, +)
        line = line.replace(/^(\s*[-*+]\s+)/, "");
        // Remove ordered list markers (1., 2., etc.)
        line = line.replace(/^(\s*\d+\.\s+)/, "");
        // Remove blockquote markers
        line = line.replace(/^>\s?/, "");
        return line;
      });
      text = cleanedLines.join("\n");

      // === 2. Remove inline formatting ===
      text = text
        // Images: ![alt](url) → alt
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
        // Links: [text](url) → text
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        // Bold: **text** or __text__
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/__(.+?)__/g, "$1")
        // Italic: *text* or _text_
        .replace(/\*(.+?)\*/g, "$1")
        .replace(/_(.+?)_/g, "$1")
        // Strikethrough: ~~text~~
        .replace(/~~(.+?)~~/g, "$1")
        // Inline code: `code`
        .replace(/`(.+?)`/g, "$1");

      return {
        changes: { from, to, insert: text },
        range: EditorSelection.range(from, from + text.length),
      };
    });

    dispatch(changes);
    view.focus();
  },
};
