import { useRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFocusTrap } from "./useFocusTrap";

function FocusTrapFixture({
  active,
  withSaveButton = false,
}: {
  active: boolean;
  withSaveButton?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, active);

  return (
    <div ref={containerRef} data-testid="trap">
      <button type="button">Close</button>
      <div className="code-editor">
        <div
          className="cm-content"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label="Editor"
          tabIndex={0}
        >
          Editor
        </div>
      </div>
      {withSaveButton && <button type="button">Save</button>}
    </div>
  );
}

function NestedTrapFixture({ outerActive }: { outerActive: boolean }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(outerRef, outerActive);
  useFocusTrap(innerRef, true);

  return (
    <>
      <div ref={outerRef}>
        <button type="button">Gallery close</button>
      </div>
      <div ref={innerRef}>
        <button type="button">Editor close</button>
        <div className="code-editor">
          <div
            className="cm-content"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-label="Editor"
            tabIndex={0}
          >
            Editor
          </div>
        </div>
        <button type="button">Save</button>
      </div>
    </>
  );
}

describe("useFocusTrap", () => {
  it("moves focus from the close button into the editor on Tab", () => {
    render(<FocusTrapFixture active withSaveButton />);

    const close = screen.getByRole("button", { name: "Close" });
    const editor = screen.getByRole("textbox", { name: "Editor" });

    close.focus();
    fireEvent.keyDown(document, { key: "Tab", bubbles: true });
    expect(document.activeElement).toBe(editor);
  });

  it("does not intercept Tab while a code editor is focused", () => {
    render(<FocusTrapFixture active />);

    const close = screen.getByRole("button", { name: "Close" });
    const editor = screen.getByRole("textbox", { name: "Editor" });

    editor.focus();
    fireEvent.keyDown(document, { key: "Tab", bubbles: true });
    expect(document.activeElement).toBe(editor);
    expect(document.activeElement).not.toBe(close);
  });

  it("keeps focus in the editor on Tab so CodeMirror can indent", () => {
    render(<FocusTrapFixture active withSaveButton />);

    const close = screen.getByRole("button", { name: "Close" });
    const editor = screen.getByRole("textbox", { name: "Editor" });
    const save = screen.getByRole("button", { name: "Save" });

    close.focus();
    fireEvent.keyDown(document, { key: "Tab", bubbles: true });
    expect(document.activeElement).toBe(editor);

    fireEvent.keyDown(document, { key: "Tab", bubbles: true });
    expect(document.activeElement).toBe(editor);
    expect(document.activeElement).not.toBe(save);
  });

  it("cannot reach a nested overlay while an outer trap stays active", () => {
    render(<NestedTrapFixture outerActive />);

    const editorClose = screen.getByRole("button", { name: "Editor close" });
    const editor = screen.getByRole("textbox", { name: "Editor" });

    editorClose.focus();
    fireEvent.keyDown(document, { key: "Tab", bubbles: true });
    expect(document.activeElement).not.toBe(editor);
    expect(document.activeElement).toBe(editorClose);
  });

  it("allows nested overlays to manage focus when the outer trap is inactive", () => {
    render(<NestedTrapFixture outerActive={false} />);

    const editorClose = screen.getByRole("button", { name: "Editor close" });
    const editor = screen.getByRole("textbox", { name: "Editor" });

    editorClose.focus();
    fireEvent.keyDown(document, { key: "Tab", bubbles: true });
    expect(document.activeElement).toBe(editor);
  });
});
