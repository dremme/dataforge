import { type Extension, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { findLiteralMatchRanges, findSearchMatchRanges } from "./searchMatchRanges";

const matchMark = Decoration.mark({ class: "cm-query-match" });

type FindRanges = (text: string) => { from: number; to: number }[];

function buildMatchDecorations(view: EditorView, findRanges: FindRanges): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const text = view.state.doc.toString();
  for (const range of findRanges(text)) {
    builder.add(range.from, range.to, matchMark);
  }
  return builder.finish();
}

/** Marks every range `findRanges` reports; callers rebuild it when their inputs change. */
function matchHighlight(findRanges: FindRanges): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildMatchDecorations(view, findRanges);
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.decorations = buildMatchDecorations(update.view, findRanges);
        }
      }
    },
    {
      decorations: (value) => value.decorations,
    },
  );
}

export function queryMatchHighlight(query: string, useRegex: boolean): Extension {
  const trimmed = query.trim();
  if (!trimmed) return [];

  return matchHighlight((text) => findSearchMatchRanges(text, trimmed, useRegex));
}

/** Highlights fixed phrases (issue snippets) rather than a search query. */
export function literalMatchHighlight(terms: readonly string[]): Extension {
  const cleaned = terms.map((term) => term.trim()).filter(Boolean);
  if (cleaned.length === 0) return [];

  return matchHighlight((text) => findLiteralMatchRanges(text, cleaned));
}
