import { describe, expect, it } from "vitest";
import { CAPTION_SIDECAR_EXTENSIONS } from "@/shared/constants";
import { CAPTION_SIDECAR_EXTENSION_LIST } from "./captionSidecar";

describe("captionSidecar", () => {
  it("lists only .txt captions", () => {
    expect(CAPTION_SIDECAR_EXTENSIONS).toEqual([".txt"]);
    expect(CAPTION_SIDECAR_EXTENSION_LIST).toBe(".txt");
  });
});
