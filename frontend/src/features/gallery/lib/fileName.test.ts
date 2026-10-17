import { describe, expect, it } from "vitest";
import { splitFileName } from "./fileName";

describe("splitFileName", () => {
  it("separates the stem from the extension, keeping its case", () => {
    expect(splitFileName("sunset.PNG")).toEqual({ stem: "sunset", extension: ".PNG" });
  });

  it("splits at the last dot", () => {
    expect(splitFileName("clip.v2.final.mp4")).toEqual({
      stem: "clip.v2.final",
      extension: ".mp4",
    });
  });

  it("treats a name without a usable dot as all stem", () => {
    expect(splitFileName("README")).toEqual({ stem: "README", extension: "" });
    expect(splitFileName(".hidden")).toEqual({ stem: ".hidden", extension: "" });
  });
});
