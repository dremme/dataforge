import { describe, expect, it } from "vitest";
import { isExternalFileDrag } from "./dragTransfer";

function mockDataTransfer(types: string[]): DataTransfer {
  return { types } as unknown as DataTransfer;
}

describe("isExternalFileDrag", () => {
  it("accepts file drags without html metadata", () => {
    expect(isExternalFileDrag(mockDataTransfer(["Files"]))).toBe(true);
  });

  it("rejects in-page image drags that include html metadata", () => {
    expect(isExternalFileDrag(mockDataTransfer(["Files", "text/html", "text/uri-list"]))).toBe(
      false,
    );
  });

  it("rejects non-file drags", () => {
    expect(isExternalFileDrag(mockDataTransfer(["text/plain"]))).toBe(false);
  });
});
