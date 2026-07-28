import { type Extension, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { findSearchMatchRanges } from "./searchMatchRanges";

const matchMark = Decoration.mark({ class: "cm-query-match" });

function buildMatchDecorations(view: EditorView, query: string, useRegex: boolean): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const text = view.state.doc.toString();
  for (const range of findSearchMatchRanges(text, query, useRegex)) {
    builder.add(range.from, range.to, matchMark);
  }
  return builder.finish();
}

/**
 * Highlights spans that match the active gallery search query.
 * Empty / whitespace query yields no decorations.
 */
export function queryMatchHighlight(query: string, useRegex: boolean): Extension {
  const trimmed = query.trim();
  if (!trimmed) return [];

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildMatchDecorations(view, trimmed, useRegex);
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.decorations = buildMatchDecorations(update.view, trimmed, useRegex);
        }
      }
    },
    {
      decorations: (value) => value.decorations,
    },
  );
}
