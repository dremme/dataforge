import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EDITOR_OPTIONS,
  EditorOptionsContext,
  type EditorOptions,
} from "@/shared/preferences/editorPreferences";
import { CaptionEditor } from "./CaptionEditor";
import { CodeMirrorEditor } from "./CodeMirrorEditor";

// The real editor renders the attributes and gutters these tests read.
vi.unmock("@uiw/react-codemirror");
vi.unmock("@codemirror/state");
vi.unmock("@codemirror/view");
vi.unmock("@codemirror/lang-markdown");
vi.unmock("@codemirror/search");

function renderWithOptions(element: React.ReactElement, options: Partial<EditorOptions> = {}) {
  return render(
    <EditorOptionsContext value={{ ...DEFAULT_EDITOR_OPTIONS, ...options }}>
      {element}
    </EditorOptionsContext>,
  );
}

function content(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>(".cm-content");
  if (!element) throw new Error("editor content not rendered");
  return element;
}

describe("CaptionEditor", () => {
  it("checks spelling in the chosen language, with numbered, wrapped lines by default", () => {
    const { container } = renderWithOptions(
      <CaptionEditor value="A red fox" onChange={vi.fn<(value: string) => void>()} />,
      { captionSpellcheckLanguage: "de" },
    );

    expect(content(container)).toHaveAttribute("spellcheck", "true");
    expect(content(container)).toHaveAttribute("lang", "de");
    expect(content(container)).toHaveClass("cm-lineWrapping");
    expect(container.querySelector(".cm-lineNumbers")).toBeInTheDocument();
  });

  it("turns spelling, line numbers, and wrapping off when asked", () => {
    const { container } = renderWithOptions(
      <CaptionEditor value="A red fox" onChange={vi.fn<(value: string) => void>()} />,
      { captionSpellcheck: false, lineNumbers: false, lineWrap: false },
    );

    expect(content(container)).toHaveAttribute("spellcheck", "false");
    expect(content(container)).not.toHaveClass("cm-lineWrapping");
    expect(container.querySelector(".cm-lineNumbers")).toBeNull();
  });

  it("leaves other editors' spelling alone", () => {
    const { container } = renderWithOptions(
      <CodeMirrorEditor
        language="markdown"
        value="# Notes"
        onChange={vi.fn<(value: string) => void>()}
      />,
      { captionSpellcheck: false, captionSpellcheckLanguage: "de", lineNumbers: false },
    );

    expect(content(container)).toHaveAttribute("spellcheck", "true");
    expect(content(container)).toHaveAttribute("lang", "en");
    expect(container.querySelector(".cm-lineNumbers")).toBeNull();
  });
});
