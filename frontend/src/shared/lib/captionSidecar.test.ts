import { describe, expect, it } from "vitest";
import { CAPTION_SIDECAR_EXTENSIONS } from "@/shared/constants";
import { CAPTION_SIDECAR_EXTENSION_LIST, captionFileTypeLabel } from "./captionSidecar";

describe("captionSidecar", () => {
  it("lists sidecar extensions in precedence order", () => {
    expect(CAPTION_SIDECAR_EXTENSIONS).toEqual([".json", ".txt"]);
    expect(CAPTION_SIDECAR_EXTENSION_LIST).toBe(".json/.txt");
  });

  it("labels known caption file types as uppercase format names", () => {
    expect(captionFileTypeLabel("json")).toBe("JSON");
    expect(captionFileTypeLabel("txt")).toBe("TXT");
  });

  it("falls back to uppercasing an unknown caption file type", () => {
    expect(captionFileTypeLabel("yaml")).toBe("YAML");
  });
});
