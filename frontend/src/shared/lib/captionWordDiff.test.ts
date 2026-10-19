import { describe, expect, it } from "vitest";
import { countChangedWords, diffCaptionWords, WORD_DIFF_CELL_LIMIT } from "./captionWordDiff";

describe("diffCaptionWords", () => {
  it("keeps identical text as one unchanged run", () => {
    expect(diffCaptionWords("a dog in a field", "a dog in a field")).toEqual([
      { kind: "same", text: "a dog in a field" },
    ]);
  });

  it("returns nothing for two empty captions", () => {
    expect(diffCaptionWords("", "")).toEqual([]);
  });

  it("marks a swapped word without touching its neighbours", () => {
    expect(diffCaptionWords("a red dog runs", "a blue dog runs")).toEqual([
      { kind: "same", text: "a " },
      { kind: "removed", text: "red" },
      { kind: "added", text: "blue" },
      { kind: "same", text: " dog runs" },
    ]);
  });

  it("reads adjacent replaced words as one swap", () => {
    expect(diffCaptionWords("a red dog", "a blue cat")).toEqual([
      { kind: "same", text: "a " },
      { kind: "removed", text: "red dog" },
      { kind: "added", text: "blue cat" },
    ]);
  });

  it("marks insertions at the start and the end", () => {
    expect(diffCaptionWords("dog in a field", "photo, dog in a field, sunset")).toEqual([
      { kind: "added", text: "photo, " },
      { kind: "same", text: "dog in a field" },
      { kind: "added", text: ", sunset" },
    ]);
  });

  it("compares a tag list tag by tag", () => {
    expect(diffCaptionWords("red hair, blue eyes, smile", "red hair, green eyes, smile")).toEqual([
      { kind: "same", text: "red hair, " },
      { kind: "removed", text: "blue" },
      { kind: "added", text: "green" },
      { kind: "same", text: " eyes, smile" },
    ]);
  });

  it("marks a removed word", () => {
    expect(diffCaptionWords("a small brown dog", "a brown dog")).toEqual([
      { kind: "same", text: "a " },
      { kind: "removed", text: "small " },
      { kind: "same", text: "brown dog" },
    ]);
  });

  it("shows a complete rewrite as one removal and one addition", () => {
    expect(diffCaptionWords("a dog", "two cats")).toEqual([
      { kind: "removed", text: "a dog" },
      { kind: "added", text: "two cats" },
    ]);
  });

  it("shows a whitespace-only change", () => {
    expect(diffCaptionWords("a dog\r\nin a field", "a dog in a field")).toEqual([
      { kind: "same", text: "a dog" },
      { kind: "removed", text: "\r\n" },
      { kind: "added", text: " " },
      { kind: "same", text: "in a field" },
    ]);
  });

  it("falls back to one swap when the changed middle is too large to align", () => {
    const words = Math.ceil(Math.sqrt(WORD_DIFF_CELL_LIMIT));
    const before = `start ${Array.from({ length: words }, (_, i) => `a${i}`).join(" ")} end`;
    const after = `start ${Array.from({ length: words }, (_, i) => `b${i}`).join(" ")} end`;

    const segments = diffCaptionWords(before, after);

    expect(segments.map((segment) => segment.kind)).toEqual(["same", "removed", "added", "same"]);
    expect(segments[0].text).toBe("start ");
    expect(segments[3].text).toBe(" end");
    expect(segments.map((s) => (s.kind === "added" ? "" : s.text)).join("")).toBe(before);
    expect(segments.map((s) => (s.kind === "removed" ? "" : s.text)).join("")).toBe(after);
  });
});

describe("countChangedWords", () => {
  it("counts the words each side alone has, ignoring punctuation and spaces", () => {
    const segments = diffCaptionWords("red hair, blue eyes", "red hair, green eyes, smiling");

    expect(countChangedWords(segments)).toEqual({ removed: 1, added: 2 });
  });

  it("counts nothing for identical captions", () => {
    expect(countChangedWords(diffCaptionWords("a dog", "a dog"))).toEqual({ removed: 0, added: 0 });
  });
});
