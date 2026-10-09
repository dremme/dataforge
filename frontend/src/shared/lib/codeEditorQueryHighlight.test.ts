import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { literalMatchHighlight, queryMatchHighlight } from "./codeEditorQueryHighlight";

vi.unmock("@codemirror/state");
vi.unmock("@codemirror/view");

let view: EditorView | null = null;

function markedText(doc: string, extension: Extension): string[] {
  view = new EditorView({
    state: EditorState.create({ doc, extensions: extension }),
    parent: document.body,
  });
  return Array.from(view.dom.querySelectorAll(".cm-query-match"), (mark) => mark.textContent ?? "");
}

afterEach(() => {
  view?.destroy();
  view = null;
});

describe("codeEditorQueryHighlight", () => {
  it("marks every match of the search query", () => {
    expect(markedText("sunset over the sun", queryMatchHighlight("sun", false))).toEqual([
      "sun",
      "sun",
    ]);
  });

  it("marks each literal phrase", () => {
    expect(
      markedText("a red car and a blue car", literalMatchHighlight(["red car", "blue car"])),
    ).toEqual(["red car", "blue car"]);
  });

  it("marks nothing for a blank query", () => {
    expect(markedText("sunset", queryMatchHighlight("  ", false))).toEqual([]);
  });

  it("re-marks the text after an edit", () => {
    markedText("sunset", queryMatchHighlight("sun", false));

    view!.dispatch({ changes: { from: view!.state.doc.length, insert: " and sun" } });

    expect(
      Array.from(view!.dom.querySelectorAll(".cm-query-match"), (mark) => mark.textContent),
    ).toEqual(["sun", "sun"]);
  });
});
