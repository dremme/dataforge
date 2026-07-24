import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor";

describe("MarkdownEditor", () => {
  it("preserves the caret when only non-value props change", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MarkdownEditor value="Hello world" aria-label="Prompt" onChange={onChange} />,
    );

    const editor = screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement;
    editor.focus();
    editor.setSelectionRange(6, 6);
    fireEvent.mouseUp(editor);

    rerender(
      <MarkdownEditor
        value="Hello world"
        aria-label="Prompt"
        className="code-editor--saved"
        onChange={onChange}
      />,
    );

    expect(editor.selectionStart).toBe(6);
    expect(editor.selectionEnd).toBe(6);
  });

  it("does not restore a stale caret after save feedback while the user repositions", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MarkdownEditor value="Hello world" aria-label="Prompt" onChange={onChange} />,
    );

    const editor = screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement;
    editor.focus();
    editor.setSelectionRange(11, 11);
    fireEvent.mouseUp(editor);

    editor.setSelectionRange(6, 6);

    rerender(
      <MarkdownEditor
        value="Hello world"
        aria-label="Prompt"
        className="code-editor--saved"
        onChange={onChange}
      />,
    );

    expect(editor.selectionStart).toBe(6);
    expect(editor.selectionEnd).toBe(6);
  });
});
