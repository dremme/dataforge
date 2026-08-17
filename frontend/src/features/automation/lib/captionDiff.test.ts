import { describe, expect, it } from "vitest";
import { diffCaption } from "./captionDiff";

describe("diffCaption", () => {
  it("brackets a replaced word with the untouched text", () => {
    expect(diffCaption("a photo of a dog", "a photo of a cat")).toEqual({
      prefix: "a photo of a ",
      removed: "dog",
      added: "cat",
      suffix: "",
    });
  });

  it("reports a prepend as a pure insertion", () => {
    expect(diffCaption("a dog", "sks person, a dog")).toEqual({
      prefix: "",
      removed: "",
      added: "sks person, ",
      suffix: "a dog",
    });
  });

  it("reports an append as a pure insertion", () => {
    expect(diffCaption("a dog", "a dog, high quality")).toEqual({
      prefix: "a dog",
      removed: "",
      added: ", high quality",
      suffix: "",
    });
  });

  it("reports a deletion with no added text", () => {
    expect(diffCaption("a big dog", "a dog")).toEqual({
      prefix: "a ",
      removed: "big ",
      added: "",
      suffix: "dog",
    });
  });

  // A shared trailing character must not be claimed by both halves, or the added
  // text would come out empty and the sample would show no change at all.
  it("does not let the prefix and the suffix overlap on a repeat", () => {
    expect(diffCaption("aa", "aaa")).toEqual({
      prefix: "aa",
      removed: "",
      added: "a",
      suffix: "",
    });
  });

  it("leaves an unchanged caption with an empty change", () => {
    expect(diffCaption("a dog", "a dog")).toEqual({
      prefix: "a dog",
      removed: "",
      added: "",
      suffix: "",
    });
  });

  it("trims a long caption back to the words around the change", () => {
    const lead = "an extremely detailed studio photograph taken on a bright afternoon of a ";
    const tail = " sitting on a weathered wooden bench beside a quiet canal in the old town";

    const diff = diffCaption(`${lead}dog${tail}`, `${lead}cat${tail}`);

    expect(diff.removed).toBe("dog");
    expect(diff.added).toBe("cat");
    expect(diff.prefix.startsWith("…")).toBe(true);
    expect(diff.suffix.endsWith("…")).toBe(true);
    // Both sides keep the words next to the change, not the whole caption.
    expect(diff.prefix.length).toBeLessThan(lead.length);
    expect(diff.prefix).toContain("afternoon of a ");
    expect(diff.suffix).toContain(" sitting on a weathered");
  });

  it("elides changed text that is itself enormous", () => {
    const diff = diffCaption("x".repeat(400), "y".repeat(400));

    expect(diff.removed.endsWith("…")).toBe(true);
    expect(diff.added.endsWith("…")).toBe(true);
    expect(diff.removed.length).toBeLessThan(120);
  });
});
