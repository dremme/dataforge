import { describe, expect, it } from "vitest";
import type { InstructionFileResponse } from "@/shared/types";
import { instructionApplies } from "./folderInstructions";

const NO_FILE: InstructionFileResponse = {
  text: "",
  has_file: false,
  parent_folder: null,
  parent_relative_path: null,
  parent_text: "",
};

describe("instructionApplies", () => {
  it("applies the folder's own text", () => {
    expect(instructionApplies({ ...NO_FILE, text: "Describe.", has_file: true })).toBe(true);
  });

  it("falls back to the parent's text while the folder has no file", () => {
    expect(instructionApplies({ ...NO_FILE, parent_text: "Describe." })).toBe(true);
  });

  it("lets an empty file of the folder's own hide the parent's", () => {
    expect(
      instructionApplies({ ...NO_FILE, text: "  ", has_file: true, parent_text: "Describe." }),
    ).toBe(false);
  });

  it("does not apply when there is nothing anywhere", () => {
    expect(instructionApplies(NO_FILE)).toBe(false);
  });
});
