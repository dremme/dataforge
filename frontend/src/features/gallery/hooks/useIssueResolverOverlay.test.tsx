import { StrictMode, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GalleryItem } from "@/shared/types";
import { useIssueResolverOverlay } from "./useIssueResolverOverlay";

function item(name: string, overrides: Partial<GalleryItem> = {}): GalleryItem {
  return {
    name,
    path: `C:\\Photos\\${name}`,
    description: "A red car in the street.",
    has_description: true,
    has_caption_file: true,
    issue_fixes: ['Replace "a blue car" with "a red car".'],
    has_issue_file: true,
    has_duplicate_file: false,
    has_backup: false,
    caption_status: "text",
    caption_file_type: "txt",
    media_type: "image",
    ...overrides,
  };
}

const flagged = [item("car.png"), item("boat.png")];

function wrapper({ children }: { children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>;
}

describe("useIssueResolverOverlay", () => {
  it("returns to the originating item when the session was opened for one file", () => {
    const onReturnToItem = vi.fn();
    const { result } = renderHook(() => useIssueResolverOverlay(onReturnToItem), { wrapper });

    act(() => result.current.openIssueResolver([flagged[0]], flagged[0].path));
    expect(result.current.open).toBe(true);
    expect(result.current.items).toHaveLength(1);

    act(() => result.current.closeIssueResolver());

    expect(onReturnToItem).toHaveBeenCalledWith(flagged[0].path);
    expect(result.current.open).toBe(false);
  });

  it("closes to the gallery when the whole folder queue was opened", () => {
    const onReturnToItem = vi.fn();
    const { result } = renderHook(() => useIssueResolverOverlay(onReturnToItem), { wrapper });

    // The automation panel's shape: a queue, no originating file.
    act(() => result.current.openIssueResolver(flagged));
    act(() => result.current.closeIssueResolver());

    expect(onReturnToItem).not.toHaveBeenCalled();
    expect(result.current.open).toBe(false);
  });

  it("keeps only the resolvable items and starts the queue at the top", () => {
    const { result } = renderHook(() => useIssueResolverOverlay(), { wrapper });

    act(() =>
      result.current.openIssueResolver([
        flagged[0],
        item(".sysprompt", { media_type: "sysprompt" }),
        item("clean.png", { has_issue_file: false }),
      ]),
    );

    expect(result.current.items.map((entry) => entry.name)).toEqual(["car.png"]);
    expect(result.current.index).toBe(0);
  });

  it("clears the queue and the return path so a second close cannot fire again", () => {
    const onReturnToItem = vi.fn();
    const { result } = renderHook(() => useIssueResolverOverlay(onReturnToItem), { wrapper });

    act(() => result.current.openIssueResolver([flagged[0]], flagged[0].path));
    act(() => result.current.setIndex(1));
    act(() => result.current.closeIssueResolver());

    expect(result.current.items).toEqual([]);
    expect(result.current.index).toBe(0);

    act(() => result.current.closeIssueResolver());

    expect(onReturnToItem).toHaveBeenCalledTimes(1);
  });

  it("carries a fresh return path across back-to-back sessions", () => {
    const onReturnToItem = vi.fn();
    const { result } = renderHook(() => useIssueResolverOverlay(onReturnToItem), { wrapper });

    act(() => result.current.openIssueResolver([flagged[0]], flagged[0].path));
    act(() => result.current.closeIssueResolver());

    act(() => result.current.openIssueResolver([flagged[1]], flagged[1].path));
    act(() => result.current.closeIssueResolver());

    expect(onReturnToItem).toHaveBeenNthCalledWith(1, flagged[0].path);
    expect(onReturnToItem).toHaveBeenNthCalledWith(2, flagged[1].path);
  });
});
