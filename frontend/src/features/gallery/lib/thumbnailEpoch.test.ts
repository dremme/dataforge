import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { advanceThumbnailEpoch, useThumbnailEpoch } from "./thumbnailEpoch";

describe("thumbnail epoch", () => {
  it("advancing it re-renders every reader and survives a reload", () => {
    const { result } = renderHook(() => useThumbnailEpoch());
    const before = result.current;

    act(() => advanceThumbnailEpoch());

    expect(result.current).toBe(before + 1);
    expect(localStorage.getItem("thumbnail-epoch")).toBe(String(before + 1));
  });
});
