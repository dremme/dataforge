import { EditorView } from "@codemirror/view";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor";

vi.unmock("@uiw/react-codemirror");
vi.unmock("@codemirror/state");
vi.unmock("@codemirror/view");
vi.unmock("@codemirror/lang-markdown");
vi.unmock("@codemirror/search");

function renderEditor(value: string) {
  const onChange = vi.fn();
  const { container } = render(
    <MarkdownEditor value={value} aria-label="Prompt" onChange={onChange} />,
  );
  const content = container.querySelector<HTMLElement>(".cm-content");
  const view = content && EditorView.findFromDOM(content);
  if (!view) throw new Error("CodeMirror view did not mount");
  return { view, onChange };
}

describe("MarkdownEditor toolbar", () => {
  it.each([
    ["Heading 1", "# word"],
    ["Heading 2", "## word"],
    ["Heading 3", "### word"],
    ["Bold", "**word**"],
    ["Italic", "*word*"],
    ["Strikethrough", "~~word~~"],
    ["Quote", "> word"],
    ["Code", "`word`"],
    ["Unordered list", "- word"],
    ["Ordered list", "1. word"],
  ])("formats the selection with %s", (name, expected) => {
    const { view, onChange } = renderEditor("word");
    view.dispatch({ selection: { anchor: 0, head: 4 } });

    fireEvent.click(screen.getByRole("button", { name }));

    expect(onChange).toHaveBeenLastCalledWith(expected);
  });

  it("links the selection to the URL the user enters", () => {
    vi.spyOn(window, "prompt").mockReturnValue("https://example.com");
    const { view, onChange } = renderEditor("word");
    view.dispatch({ selection: { anchor: 0, head: 4 } });

    fireEvent.click(screen.getByRole("button", { name: "Link" }));

    expect(onChange).toHaveBeenLastCalledWith("[word](https://example.com)");
  });

  it("keeps focus in the editor when a toolbar button is pressed", () => {
    renderEditor("word");

    // A prevented mousedown leaves focus, and so the selection, in the editor.
    expect(fireEvent.mouseDown(screen.getByRole("button", { name: "Bold" }))).toBe(false);
  });

  it("removes only the link when Remove link is clicked", () => {
    const value = "**bold** [text](https://example.com)";
    const { view, onChange } = renderEditor(value);
    view.dispatch({ selection: { anchor: 0, head: value.length } });

    fireEvent.click(screen.getByRole("button", { name: "Remove link" }));

    expect(onChange).toHaveBeenLastCalledWith("**bold** text");
  });

  it("strips all formatting when Remove formatting is clicked", () => {
    const value = "**bold** [text](https://example.com)";
    const { view, onChange } = renderEditor(value);
    view.dispatch({ selection: { anchor: 0, head: value.length } });

    fireEvent.click(screen.getByRole("button", { name: "Remove formatting" }));

    expect(onChange).toHaveBeenLastCalledWith("bold text");
  });
});
