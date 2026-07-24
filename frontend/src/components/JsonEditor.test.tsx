import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JsonEditor } from "./JsonEditor";

describe("JsonEditor", () => {
  it("renders JSON content in a CodeMirror textbox", () => {
    const onChange = vi.fn();
    render(
      <JsonEditor value='{"description":"Scene"}' aria-label="JSON caption" onChange={onChange} />,
    );

    const editor = screen.getByRole("textbox", { name: "JSON caption" }) as HTMLTextAreaElement;
    expect(editor).toHaveValue('{"description":"Scene"}');
  });

  it("preserves the caret when only non-value props change", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <JsonEditor value='{"description":"Scene"}' aria-label="JSON caption" onChange={onChange} />,
    );

    const editor = screen.getByRole("textbox", { name: "JSON caption" }) as HTMLTextAreaElement;
    editor.focus();
    editor.setSelectionRange(4, 4);
    fireEvent.mouseUp(editor);

    rerender(
      <JsonEditor
        value='{"description":"Scene"}'
        aria-label="JSON caption"
        className="code-editor--error"
        onChange={onChange}
      />,
    );

    expect(editor.selectionStart).toBe(4);
    expect(editor.selectionEnd).toBe(4);
  });
});
