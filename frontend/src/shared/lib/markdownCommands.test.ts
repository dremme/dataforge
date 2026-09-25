import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { markdownCommands } from "./markdownCommands";

vi.unmock("@codemirror/state");
vi.unmock("@codemirror/view");

const views: EditorView[] = [];

function createView(doc: string, anchor: number, head = anchor) {
  const view = new EditorView({
    doc,
    selection: EditorSelection.single(anchor, head),
    parent: document.body,
  });
  views.push(view);
  return view;
}

afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
});

describe("markdownCommands.unlink", () => {
  it("replaces every link in the selection with its text and keeps other formatting", () => {
    const doc = "**bold** [text](https://example.com) and [more](https://example.org)";
    const view = createView(doc, 0, doc.length);

    markdownCommands.unlink(view);

    expect(view.state.doc.toString()).toBe("**bold** text and more");
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe("**bold** text and more".length);
  });

  it("unwraps a link that the selection only partially covers", () => {
    const doc = "see [text](https://example.com) here";
    const view = createView(doc, 6, 8);

    markdownCommands.unlink(view);

    expect(view.state.doc.toString()).toBe("see text here");
  });

  it("unwraps the link around the cursor when nothing is selected", () => {
    const doc = "[first](https://example.com) and [second](https://example.org)";
    const view = createView(doc, doc.indexOf("second") + 2);

    markdownCommands.unlink(view);

    expect(view.state.doc.toString()).toBe("[first](https://example.com) and second");
    expect(view.state.selection.main.head).toBe("[first](https://example.com) and ".length + 2);
  });

  it("leaves the document unchanged when the cursor is outside any link", () => {
    const doc = "**bold** and [text](https://example.com)";
    const view = createView(doc, 3);

    markdownCommands.unlink(view);

    expect(view.state.doc.toString()).toBe(doc);
  });

  it("keeps images intact", () => {
    const doc = "![alt](https://example.com/photo.png) [text](https://example.com)";
    const view = createView(doc, 0, doc.length);

    markdownCommands.unlink(view);

    expect(view.state.doc.toString()).toBe("![alt](https://example.com/photo.png) text");
  });
});
