import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useGallerySelection } from "./useGallerySelection";

describe("useGallerySelection", () => {
  it("enters selection mode and tracks selected paths", () => {
    const { result } = renderHook(() => useGallerySelection());

    act(() => {
      result.current.enterSelectionMode();
      result.current.toggleSelectedPath("/photos/a.png");
      result.current.toggleSelectedPath("/photos/b.png");
    });

    expect(result.current.selectionMode).toBe(true);
    expect(result.current.selectedPathsList).toEqual(["/photos/a.png", "/photos/b.png"]);
  });

  it("clears selection and exits mode when leaving selection mode", () => {
    const { result } = renderHook(() => useGallerySelection());

    act(() => {
      result.current.enterSelectionMode();
      result.current.toggleSelectedPath("/photos/a.png");
      result.current.exitSelectionMode();
    });

    expect(result.current.selectionMode).toBe(false);
    expect(result.current.selectedPathsList).toEqual([]);
  });

  it("does not carry a selection back into a re-entered selection mode", () => {
    const { result } = renderHook(() => useGallerySelection());

    act(() => {
      result.current.enterSelectionMode();
      result.current.toggleSelectedPath("/photos/a.png");
      result.current.exitSelectionMode();
      result.current.enterSelectionMode();
    });

    expect(result.current.selectedPathsList).toEqual([]);
  });

  it("adds to the selection rather than replacing it when selecting all", () => {
    const { result } = renderHook(() => useGallerySelection());

    // "All" is only ever handed the visible paths, so a replace would drop
    // whatever a previous, wider filter left selected off screen.
    act(() => {
      result.current.enterSelectionMode();
      result.current.selectAllPaths(["/photos/a.png"]);
      result.current.selectAllPaths(["/photos/b.png"]);
    });

    expect(result.current.selectedPathsList).toEqual(["/photos/a.png", "/photos/b.png"]);
  });

  it("inverts the given paths and leaves anything else selected", () => {
    const { result } = renderHook(() => useGallerySelection());

    act(() => {
      result.current.enterSelectionMode();
      result.current.selectAllPaths(["/photos/a.png", "/photos/hidden.png"]);
      result.current.invertSelectedPaths(["/photos/a.png", "/photos/b.png"]);
    });

    expect(result.current.selectedPathsList).toEqual(["/photos/hidden.png", "/photos/b.png"]);
  });

  it("removes only the deleted paths from the current selection", () => {
    const { result } = renderHook(() => useGallerySelection());

    act(() => {
      result.current.enterSelectionMode();
      result.current.toggleSelectedPath("/photos/a.png");
      result.current.toggleSelectedPath("/photos/b.png");
      result.current.removeSelectedPaths(["/photos/a.png"]);
    });

    expect(result.current.selectedPathsList).toEqual(["/photos/b.png"]);
  });

  it("clears everything on folder reset", () => {
    const { result } = renderHook(() => useGallerySelection());

    act(() => {
      result.current.enterSelectionMode();
      result.current.toggleSelectedPath("/photos/a.png");
      result.current.clearSelection();
    });

    expect(result.current.selectionMode).toBe(false);
    expect(result.current.selectedPathsList).toEqual([]);
  });
});
