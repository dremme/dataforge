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
    const startLine = doc.lineAt(range.from);
    const endLine = doc.lineAt(range.to);

    const from = startLine.from;
    const to = endLine.to;

    const text = doc.sliceString(from, to);
    const lines = text.split("\n");

    const newLines = lines.map((line) => `${prefix}${line.trimStart()}`);
    const newText = newLines.join("\n");

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

      if (from === to) {
        const line = state.doc.lineAt(from);
        from = line.from;
        to = line.to;
      }

      let text = state.doc.sliceString(from, to);

      const lines = text.split("\n");
      const cleanedLines = lines.map((line) => {
        line = line.replace(/^#{1,6}\s+/, "");
        line = line.replace(/^(\s*[-*+]\s+)/, "");
        line = line.replace(/^(\s*\d+\.\s+)/, "");
        line = line.replace(/^>\s?/, "");
        return line;
      });
      text = cleanedLines.join("\n");

      text = text
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/__(.+?)__/g, "$1")
        .replace(/\*(.+?)\*/g, "$1")
        .replace(/_(.+?)_/g, "$1")
        .replace(/~~(.+?)~~/g, "$1")
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
