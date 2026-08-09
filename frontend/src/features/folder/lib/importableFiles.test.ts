import { describe, expect, it } from "vitest";
import { SYSPROMPT_FILENAME } from "@/shared/constants";
import { filterImportableFiles, isImportableFileName } from "./importableFiles";

describe("isImportableFileName", () => {
  it("accepts supported media, caption, and sysprompt files", () => {
    expect(isImportableFileName("photo.png")).toBe(true);
    expect(isImportableFileName("clip.mp4")).toBe(true);
    expect(isImportableFileName("caption.txt")).toBe(true);
    expect(isImportableFileName("scene.json")).toBe(true);
    expect(isImportableFileName(SYSPROMPT_FILENAME)).toBe(true);
  });

  it("rejects unsupported files", () => {
    expect(isImportableFileName("notes.md")).toBe(false);
    expect(isImportableFileName("archive.zip")).toBe(false);
  });
});

describe("filterImportableFiles", () => {
  it("keeps only compatible files from a dropped list", () => {
    const files = [
      new File(["a"], "photo.png", { type: "image/png" }),
      new File(["b"], "notes.md", { type: "text/plain" }),
      new File(["c"], SYSPROMPT_FILENAME, { type: "text/plain" }),
    ];

    expect(filterImportableFiles(files).map((file) => file.name)).toEqual([
      "photo.png",
      SYSPROMPT_FILENAME,
    ]);
  });
});
