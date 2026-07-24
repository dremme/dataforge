import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useGallerySelection } from "./useGallerySelection";

describe("useGallerySelection", () => {
  it("enters selection mode and tracks selected paths for jobs", () => {
    const { result } = renderHook(() => useGallerySelection());

    act(() => {
      result.current.enterSelectionMode();
      result.current.toggleSelectedPath("/photos/a.png");
      result.current.toggleSelectedPath("/photos/b.png");
    });

    expect(result.current.selectionMode).toBe(true);
    expect(result.current.selectedCount).toBe(2);
    expect(result.current.getJobPaths()).toEqual(["/photos/a.png", "/photos/b.png"]);
  });

  it("clears selection and exits mode when leaving selection mode", () => {
    const { result } = renderHook(() => useGallerySelection());

    act(() => {
      result.current.enterSelectionMode();
      result.current.toggleSelectedPath("/photos/a.png");
      result.current.exitSelectionMode();
    });

    expect(result.current.selectionMode).toBe(false);
    expect(result.current.selectedCount).toBe(0);
    expect(result.current.getJobPaths()).toBeUndefined();
  });

  it("does not scope jobs after exiting selection mode", () => {
    const { result } = renderHook(() => useGallerySelection());

    act(() => {
      result.current.enterSelectionMode();
      result.current.toggleSelectedPath("/photos/a.png");
      result.current.exitSelectionMode();
      result.current.enterSelectionMode();
    });

    expect(result.current.getJobPaths()).toBeUndefined();
  });

  it("removes only the deleted paths from the current selection", () => {
    const { result } = renderHook(() => useGallerySelection());

    act(() => {
      result.current.enterSelectionMode();
      result.current.toggleSelectedPath("/photos/a.png");
      result.current.toggleSelectedPath("/photos/b.png");
      result.current.removeSelectedPaths(["/photos/a.png"]);
    });

    expect(result.current.selectedCount).toBe(1);
    expect(result.current.getJobPaths()).toEqual(["/photos/b.png"]);
  });

  it("clears everything on folder reset", () => {
    const { result } = renderHook(() => useGallerySelection());

    act(() => {
      result.current.enterSelectionMode();
      result.current.toggleSelectedPath("/photos/a.png");
      result.current.clearSelection();
    });

    expect(result.current.selectionMode).toBe(false);
    expect(result.current.selectedCount).toBe(0);
  });
});
