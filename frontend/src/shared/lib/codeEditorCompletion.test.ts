import { describe, expect, it, vi } from "vitest";
import {
  completionStatus,
  startCompletion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { waitFor } from "@testing-library/react";
import type { VocabularyEntry } from "@/features/gallery/lib/captionVocabulary";
import { captionCompletionSource, vocabularyCompletion } from "./codeEditorCompletion";

vi.unmock("@codemirror/state");
vi.unmock("@codemirror/view");

const VOCABULARY: VocabularyEntry[] = [
  { label: "harbour", count: 9, kind: "word" },
  { label: "harbour at dawn", count: 4, kind: "tag" },
  { label: "mountain", count: 6, kind: "word" },
];

/** The slice of CompletionContext the source touches. */
function contextFor(textBefore: string, explicit = false): CompletionContext {
  return {
    explicit,
    matchBefore(pattern: RegExp) {
      const match = textBefore.match(pattern);
      if (!match) return null;
      const from = textBefore.length - match[0].length;
      return { from, to: textBefore.length, text: match[0] };
    },
  } as unknown as CompletionContext;
}

describe("captionCompletionSource", () => {
  const source = captionCompletionSource(VOCABULARY);

  it("suggests nothing for a one-character prefix", () => {
    expect(source(contextFor("h"))).toBeNull();
  });

  it("suggests every entry sharing the typed prefix", () => {
    const result = source(contextFor("har"));

    expect(result?.options.map((option) => option.label)).toEqual(["harbour", "harbour at dawn"]);
  });

  it("completes the last word of a prose caption, not the whole line", () => {
    const result = source(contextFor("a boat in the harb"));

    expect(result?.from).toBe("a boat in the ".length);
    expect(result?.options.map((option) => option.label)).toEqual(["harbour", "harbour at dawn"]);
  });

  it("completes a tag from where it starts after a comma", () => {
    const result = source(contextFor("blue hour, harb"));

    expect(result?.from).toBe("blue hour, ".length);
  });

  it("completes a multi-word tag across its spaces", () => {
    const result = source(contextFor("harbour at d"));

    expect(result?.options.map((option) => option.label)).toEqual(["harbour at dawn"]);
  });

  it("does not offer the word already typed in full", () => {
    expect(source(contextFor("mountain"))?.options.map((option) => option.label)).toBeUndefined();
  });

  it("ranks a frequent word above a rarer one", () => {
    const result = captionCompletionSource([
      { label: "harbour", count: 2, kind: "word" },
      { label: "harbourside", count: 40, kind: "word" },
    ])(contextFor("harb"));

    const boosts = result?.options.map((option) => option.boost ?? 0) ?? [];
    expect(boosts[1]).toBeGreaterThan(boosts[0]);
  });

  it("suggests nothing when the folder has no vocabulary", () => {
    expect(captionCompletionSource([])(contextFor("harb"))).toBeNull();
  });

  it("answers an explicit request even for a short prefix", () => {
    expect(source(contextFor("h", true))?.options).toHaveLength(2);
  });
});

describe("vocabularyCompletion", () => {
  function editorTyping(activateOnTyping: boolean): EditorView {
    const view = new EditorView({
      state: EditorState.create({ extensions: vocabularyCompletion(VOCABULARY, activateOnTyping) }),
      parent: document.body,
    });
    view.dispatch({
      changes: { from: 0, insert: "har" },
      selection: { anchor: 3 },
      userEvent: "input.type",
    });
    return view;
  }

  it("suggests while typing by default", async () => {
    const view = editorTyping(true);

    await waitFor(() => expect(completionStatus(view.state)).toBe("active"));
    view.destroy();
  });

  it("waits for an explicit request when typing does not activate it", async () => {
    const view = editorTyping(false);

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(completionStatus(view.state)).toBeNull();

    startCompletion(view);
    await waitFor(() => expect(completionStatus(view.state)).toBe("active"));
    view.destroy();
  });
});
