import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { afterEach, describe, expect, it, vi } from "vitest";
import { leaveModEnterToHost } from "./codeEditorCommitKey";

vi.unmock("@codemirror/state");
vi.unmock("@codemirror/view");

const views: EditorView[] = [];

function mountEditor(withGuard: boolean): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc: "A red car",
      selection: { anchor: 5 },
      extensions: [...(withGuard ? [leaveModEnterToHost] : []), keymap.of(defaultKeymap)],
    }),
    parent: document.body,
  });
  views.push(view);
  return view;
}

function pressModEnter(view: EditorView): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    keyCode: 13,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  view.contentDOM.dispatchEvent(event);
  return event;
}

afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
});

describe("leaveModEnterToHost", () => {
  it("keeps CodeMirror from inserting a blank line on Mod-Enter", () => {
    const view = mountEditor(true);

    const event = pressModEnter(view);

    expect(view.state.doc.toString()).toBe("A red car");
    expect(event.defaultPrevented).toBe(true);
  });

  it("guards against a default that really does edit the text", () => {
    const view = mountEditor(false);

    pressModEnter(view);

    expect(view.state.doc.toString()).not.toBe("A red car");
  });
});
