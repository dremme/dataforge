import { describe, expect, it } from "vitest";
import { parseJsonContent } from "./formatJson";

describe("parseJsonContent", () => {
  it("accepts JSON objects", () => {
    expect(parseJsonContent('{"description":"Scene"}')).toEqual({
      ok: true,
      value: { description: "Scene" },
    });
  });

  it("accepts JSON arrays", () => {
    expect(parseJsonContent('[{"desc":"Tree"}]')).toEqual({
      ok: true,
      value: [{ desc: "Tree" }],
    });
  });

  it("rejects invalid JSON", () => {
    expect(parseJsonContent("{bad json")).toEqual({
      ok: false,
      error: expect.any(String) as string,
    });
  });

  it("rejects primitives", () => {
    expect(parseJsonContent('"caption only"')).toEqual({
      ok: false,
      error: "Caption JSON must be an object or array.",
    });
  });
});
