import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import * as api from "@/features/gallery/api/captions";
import { ApiError } from "@/shared/api/http";
import { HOME_PATH } from "@/test/fixtures";
import { advanceFakeClock } from "@/test/timers";
import type { CaptionSaveResponse, GalleryItem } from "@/shared/types";
import { DEFAULT_DEBOUNCE_MS } from "@/shared/hooks/useDebouncedSave";
import { useGalleryItemCaption } from "./useGalleryItemCaption";

vi.mock("@/shared/lib/defer", () => ({
  deferNonCriticalWork: (callback: () => void) => {
    callback();
    return () => {};
  },
}));

function makeItem(name: string, overrides: Partial<GalleryItem> = {}): GalleryItem {
  return {
    name,
    path: `${HOME_PATH}\\${name}`,
    description: "Cached caption",
    has_description: true,
    has_caption_file: true,
    issue_fixes: [],
    rule_findings: [],
    has_issue_file: false,
    has_duplicate_file: false,
    has_backup: false,
    tags: [],
    has_candidate: false,
    caption_status: "text",
    media_type: "image",
    ...overrides,
  };
}

function captionResponse(
  description: string,
  overrides: Partial<CaptionSaveResponse> = {},
): CaptionSaveResponse {
  return {
    description,
    has_description: description.length > 0,
    has_caption_file: true,
    caption_status: "text",
    caption_file: `${HOME_PATH}\\file.txt`,
    issue_fixes: [],
    rule_findings: [],
    has_issue_file: false,
    ...overrides,
  };
}

describe("useGalleryItemCaption", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("fetches the caption once on mount", async () => {
    const fetchCaption = vi
      .spyOn(api, "fetchCaption")
      .mockResolvedValue(captionResponse("Fresh caption"));
    const onCaptionSaved = vi.fn<(path: string, update: CaptionSaveResponse) => void>();

    renderHook(() =>
      useGalleryItemCaption({
        item: makeItem("sunset.png"),
        onCaptionSaved,
      }),
    );

    await waitFor(() => {
      expect(fetchCaption).toHaveBeenCalledTimes(1);
      expect(onCaptionSaved).toHaveBeenCalledTimes(1);
    });

    expect(fetchCaption).toHaveBeenCalledWith(`${HOME_PATH}\\sunset.png`);
  });

  it("syncs folder caption updates without re-fetching when there are no local edits", async () => {
    const fetchCaption = vi
      .spyOn(api, "fetchCaption")
      .mockResolvedValue(captionResponse("Fresh caption"));
    const onCaptionSaved = vi.fn<(path: string, update: CaptionSaveResponse) => void>();

    const { result, rerender } = renderHook(
      ({ item }: { item: GalleryItem }) =>
        useGalleryItemCaption({
          item,
          onCaptionSaved,
        }),
      {
        initialProps: { item: makeItem("sunset.png") },
      },
    );

    await waitFor(() => {
      expect(fetchCaption).toHaveBeenCalledTimes(1);
      expect(result.current.caption).toBe("Fresh caption");
    });

    rerender({
      item: {
        ...makeItem("sunset.png"),
        description: "Background caption update",
        has_description: true,
      },
    });

    await waitFor(() => {
      expect(result.current.caption).toBe("Background caption update");
    });

    expect(fetchCaption).toHaveBeenCalledTimes(1);
    expect(onCaptionSaved).toHaveBeenCalledTimes(1);
  });

  it("keeps local edits when folder caption updates arrive in the background", async () => {
    vi.spyOn(api, "fetchCaption").mockResolvedValue(captionResponse("Fresh caption"));
    const onCaptionSaved = vi.fn<(path: string, update: CaptionSaveResponse) => void>();

    const { result, rerender } = renderHook(
      ({ item }: { item: GalleryItem }) =>
        useGalleryItemCaption({
          item,
          onCaptionSaved,
        }),
      {
        initialProps: { item: makeItem("sunset.png") },
      },
    );

    await waitFor(() => {
      expect(result.current.caption).toBe("Fresh caption");
    });

    act(() => {
      result.current.handleCaptionChange("Local edit in progress");
    });

    rerender({
      item: {
        ...makeItem("sunset.png"),
        description: "Background caption update",
        has_description: true,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.caption).toBe("Local edit in progress");
  });

  it("ignores stale caption responses after switching items", async () => {
    let resolveFirst: ((value: CaptionSaveResponse) => void) | undefined;
    const fetchCaption = vi.spyOn(api, "fetchCaption").mockImplementation((path) => {
      if (path.endsWith("sunset.png")) {
        return new Promise<CaptionSaveResponse>((resolve) => {
          resolveFirst = resolve;
        });
      }

      return Promise.resolve(captionResponse("Beach caption"));
    });
    const onCaptionSaved = vi.fn<(path: string, update: CaptionSaveResponse) => void>();

    const { result, rerender } = renderHook(
      ({ item }: { item: GalleryItem | undefined }) =>
        useGalleryItemCaption({
          item,
          onCaptionSaved,
        }),
      {
        initialProps: { item: makeItem("sunset.png") },
      },
    );

    rerender({ item: makeItem("beach.jpg", { description: null, has_description: false }) });

    await waitFor(() => {
      expect(result.current.caption).toBe("Beach caption");
    });

    await act(async () => {
      resolveFirst?.(captionResponse("Late sunset caption"));
      await Promise.resolve();
    });

    expect(result.current.caption).toBe("Beach caption");
    expect(fetchCaption).toHaveBeenCalledTimes(2);
    expect(onCaptionSaved).toHaveBeenCalledTimes(1);
    expect(onCaptionSaved).toHaveBeenCalledWith(
      `${HOME_PATH}\\beach.jpg`,
      expect.objectContaining({ description: "Beach caption" }),
    );
  });

  it("keeps cached folder data when the refresh request fails", async () => {
    vi.spyOn(api, "fetchCaption").mockRejectedValue(new Error("Network error"));
    const onCaptionSaved = vi.fn<(path: string, update: CaptionSaveResponse) => void>();

    const { result } = renderHook(() =>
      useGalleryItemCaption({
        item: makeItem("sunset.png"),
        onCaptionSaved,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.caption).toBe("Cached caption");
    expect(onCaptionSaved).not.toHaveBeenCalled();
  });

  it("preserves saved feedback when folder echoes the saved caption", async () => {
    vi.spyOn(api, "fetchCaption").mockResolvedValue(captionResponse("Fresh caption"));
    vi.spyOn(api, "saveCaption").mockResolvedValue(captionResponse("Edited caption"));
    const onCaptionSaved = vi.fn<(path: string, update: CaptionSaveResponse) => void>();

    const { result, rerender } = renderHook(
      ({ item }: { item: GalleryItem }) =>
        useGalleryItemCaption({
          item,
          onCaptionSaved,
        }),
      {
        initialProps: { item: makeItem("sunset.png") },
      },
    );

    await waitFor(() => {
      expect(result.current.caption).toBe("Fresh caption");
    });

    await advanceFakeClock(DEFAULT_DEBOUNCE_MS, () => {
      result.current.handleCaptionChange("Edited caption");
    });
    expect(result.current.saveState).toBe("saved");

    rerender({
      item: {
        ...makeItem("sunset.png"),
        description: "Edited caption",
        has_description: true,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.saveState).toBe("saved");
  });

  it("keeps characters typed while a save is in flight", async () => {
    vi.spyOn(api, "fetchCaption").mockResolvedValue(captionResponse("Fresh caption"));
    let resolveSave: (() => void) | undefined;
    const saveCaption = vi.spyOn(api, "saveCaption").mockImplementation(
      (_path, text) =>
        new Promise<CaptionSaveResponse>((resolve) => {
          resolveSave = () => resolve(captionResponse(text));
        }),
    );
    const onCaptionSaved = vi.fn<(path: string, update: CaptionSaveResponse) => void>();
    const item = makeItem("sunset.png", { description: "Fresh caption" });

    const { result } = renderHook(() => useGalleryItemCaption({ item, onCaptionSaved }));

    await waitFor(() => {
      expect(result.current.caption).toBe("Fresh caption");
    });

    act(() => {
      result.current.handleCaptionChange("Hello");
    });

    await waitFor(() => {
      expect(saveCaption).toHaveBeenCalledWith(`${HOME_PATH}\\sunset.png`, "Hello", {
        baseRevision: null,
      });
    });

    // The round trip is still open while the user keeps typing.
    act(() => {
      result.current.handleCaptionChange("Hello world");
    });

    await act(async () => {
      resolveSave?.();
      await Promise.resolve();
    });

    expect(result.current.caption).toBe("Hello world");
  });

  it("ignores a background folder reload that predates the last save", async () => {
    vi.spyOn(api, "fetchCaption").mockResolvedValue(captionResponse("Hello"));
    vi.spyOn(api, "saveCaption").mockImplementation(async (_path, text) => captionResponse(text));
    const onCaptionSaved = vi.fn<(path: string, update: CaptionSaveResponse) => void>();

    const { result, rerender } = renderHook(
      ({ item }: { item: GalleryItem }) => useGalleryItemCaption({ item, onCaptionSaved }),
      { initialProps: { item: makeItem("sunset.png", { description: "Hello" }) } },
    );

    await waitFor(() => {
      expect(result.current.caption).toBe("Hello");
    });

    await advanceFakeClock(DEFAULT_DEBOUNCE_MS, () => {
      result.current.handleCaptionChange("Hello world");
    });
    expect(result.current.saveState).toBe("saved");

    // The poller reloaded the folder from a response older than the save.
    rerender({ item: makeItem("sunset.png", { description: "Hello" }) });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.caption).toBe("Hello world");
  });

  it("syncs a caption changed back to text it showed before", async () => {
    vi.spyOn(api, "fetchCaption").mockResolvedValue(captionResponse("A"));
    const onCaptionSaved = vi.fn<(path: string, update: CaptionSaveResponse) => void>();
    const { result, rerender } = renderHook(
      ({ item }: { item: GalleryItem }) => useGalleryItemCaption({ item, onCaptionSaved }),
      { initialProps: { item: makeItem("sunset.png", { description: "A" }) } },
    );
    await waitFor(() => expect(result.current.caption).toBe("A"));

    rerender({ item: makeItem("sunset.png", { description: "B" }) });
    await waitFor(() => expect(result.current.caption).toBe("B"));

    // A backup restore puts the earlier text back; it is newer than B, not a stale echo.
    rerender({ item: makeItem("sunset.png", { description: "A" }) });
    await waitFor(() => expect(result.current.caption).toBe("A"));
  });

  it("syncs a restore of the pre-save text once the save has been echoed", async () => {
    vi.spyOn(api, "fetchCaption").mockResolvedValue(captionResponse("Hello"));
    vi.spyOn(api, "saveCaption").mockImplementation(async (_path, text) => captionResponse(text));
    const onCaptionSaved = vi.fn<(path: string, update: CaptionSaveResponse) => void>();
    const { result, rerender } = renderHook(
      ({ item }: { item: GalleryItem }) => useGalleryItemCaption({ item, onCaptionSaved }),
      { initialProps: { item: makeItem("sunset.png", { description: "Hello" }) } },
    );
    await waitFor(() => expect(result.current.caption).toBe("Hello"));

    await advanceFakeClock(DEFAULT_DEBOUNCE_MS, () => {
      result.current.handleCaptionChange("Hello world");
    });
    rerender({ item: makeItem("sunset.png", { description: "Hello world" }) });
    await act(async () => {
      await Promise.resolve();
    });

    rerender({ item: makeItem("sunset.png", { description: "Hello" }) });
    await waitFor(() => expect(result.current.caption).toBe("Hello"));
  });

  it("keeps characters typed before the initial caption fetch resolves", async () => {
    let resolveFetch: (() => void) | undefined;
    vi.spyOn(api, "fetchCaption").mockImplementation(
      () =>
        new Promise<CaptionSaveResponse>((resolve) => {
          resolveFetch = () => resolve(captionResponse("Fresh caption"));
        }),
    );
    vi.spyOn(api, "saveCaption").mockResolvedValue(captionResponse("Typed first"));
    const onCaptionSaved = vi.fn<(path: string, update: CaptionSaveResponse) => void>();
    const item = makeItem("sunset.png");

    const { result } = renderHook(() => useGalleryItemCaption({ item, onCaptionSaved }));

    act(() => {
      result.current.handleCaptionChange("Typed first");
    });

    await act(async () => {
      resolveFetch?.();
      await Promise.resolve();
    });

    expect(result.current.caption).toBe("Typed first");
  });

  it("does not auto-save caption edits when autoSave is false", async () => {
    vi.spyOn(api, "fetchCaption").mockRejectedValue(new Error("Network error"));
    const saveCaption = vi.spyOn(api, "saveCaption");
    const onCaptionSaved = vi.fn<(path: string, update: CaptionSaveResponse) => void>();

    const { result } = renderHook(() =>
      useGalleryItemCaption({
        item: makeItem("sunset.png"),
        onCaptionSaved,
        autoSave: false,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.handleCaptionChange("Edited caption");
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.caption).toBe("Edited caption");
    expect(saveCaption).not.toHaveBeenCalled();
    expect(result.current.saveState).toBe("idle");
  });

  it("flushes a pending save when switching items", async () => {
    vi.spyOn(api, "fetchCaption").mockResolvedValue(captionResponse("Fresh caption"));
    const saveCaption = vi.spyOn(api, "saveCaption").mockResolvedValue(captionResponse("Saved"));
    const onCaptionSaved = vi.fn<(path: string, update: CaptionSaveResponse) => void>();

    const { result, rerender } = renderHook(
      ({ item }: { item: GalleryItem }) =>
        useGalleryItemCaption({
          item,
          onCaptionSaved,
        }),
      {
        initialProps: { item: makeItem("sunset.png") },
      },
    );

    await waitFor(() => {
      expect(onCaptionSaved).toHaveBeenCalled();
    });

    act(() => {
      result.current.handleCaptionChange("Edited caption");
      rerender({ item: makeItem("beach.jpg", { description: null, has_description: false }) });
    });

    await waitFor(() => {
      expect(saveCaption).toHaveBeenCalledWith(`${HOME_PATH}\\sunset.png`, "Edited caption", {
        baseRevision: null,
      });
    });
  });

  describe("revisions", () => {
    const conflict = () =>
      new ApiError(409, "The caption changed since it was loaded", "caption_conflict");

    async function editedAfterLoad(fetchCaption: MockInstance<typeof api.fetchCaption>) {
      const onCaptionSaved = vi.fn<(path: string, update: CaptionSaveResponse) => void>();
      // One object, as a listing that has not changed: a new one per render would re-apply it.
      const item = makeItem("sunset.png", { caption_revision: "listing" });
      const rendered = renderHook(() => useGalleryItemCaption({ item, onCaptionSaved }));
      await waitFor(() => expect(fetchCaption).toHaveBeenCalled());
      await waitFor(() => expect(onCaptionSaved).toHaveBeenCalled());
      return rendered;
    }

    it("names the revision the caption was loaded at", async () => {
      const fetchCaption = vi
        .spyOn(api, "fetchCaption")
        .mockResolvedValue(captionResponse("Fresh caption", { caption_revision: "fresh" }));
      const saveCaption = vi
        .spyOn(api, "saveCaption")
        .mockResolvedValue(captionResponse("Edited", { caption_revision: "saved" }));
      const { result } = await editedAfterLoad(fetchCaption);

      act(() => result.current.handleCaptionChange("Edited"));
      await act(() => result.current.flushPendingSave());
      act(() => result.current.handleCaptionChange("Edited again"));
      await act(() => result.current.flushPendingSave());

      expect(saveCaption.mock.calls.map((call) => call[2])).toEqual([
        { baseRevision: "fresh" },
        { baseRevision: "saved" },
      ]);
    });

    it("pauses autosave on a conflict and keeps the draft", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const fetchCaption = vi
        .spyOn(api, "fetchCaption")
        .mockResolvedValue(captionResponse("Fresh caption", { caption_revision: "fresh" }));
      const saveCaption = vi.spyOn(api, "saveCaption").mockRejectedValue(conflict());
      const { result } = await editedAfterLoad(fetchCaption);

      act(() => result.current.handleCaptionChange("Mine"));
      await act(() => result.current.flushPendingSave());
      expect(result.current.saveState).toBe("conflict");

      act(() => result.current.handleCaptionChange("Mine, edited further"));
      await advanceFakeClock(DEFAULT_DEBOUNCE_MS * 2);

      expect(saveCaption).toHaveBeenCalledTimes(1);
      expect(result.current.caption).toBe("Mine, edited further");
      expect(result.current.hasUnsavedChanges).toBe(true);
    });

    it("reloads the caption from disk, dropping the draft", async () => {
      const fetchCaption = vi
        .spyOn(api, "fetchCaption")
        .mockResolvedValue(captionResponse("Fresh caption", { caption_revision: "fresh" }));
      vi.spyOn(api, "saveCaption").mockRejectedValue(conflict());
      const { result } = await editedAfterLoad(fetchCaption);
      act(() => result.current.handleCaptionChange("Mine"));
      await act(() => result.current.flushPendingSave());

      fetchCaption.mockResolvedValue(
        captionResponse("Written elsewhere", { caption_revision: "elsewhere" }),
      );
      await act(() => result.current.reloadCaption());

      expect(result.current.caption).toBe("Written elsewhere");
      expect(result.current.saveState).toBe("idle");
      expect(result.current.hasUnsavedChanges).toBe(false);
    });

    it("overwrites against the revision now on disk", async () => {
      const fetchCaption = vi
        .spyOn(api, "fetchCaption")
        .mockResolvedValue(captionResponse("Fresh caption", { caption_revision: "fresh" }));
      const saveCaption = vi.spyOn(api, "saveCaption").mockRejectedValueOnce(conflict());
      const { result } = await editedAfterLoad(fetchCaption);
      act(() => result.current.handleCaptionChange("Mine"));
      await act(() => result.current.flushPendingSave());

      fetchCaption.mockResolvedValue(
        captionResponse("Written elsewhere", { caption_revision: "elsewhere" }),
      );
      saveCaption.mockResolvedValue(captionResponse("Mine", { caption_revision: "mine" }));
      let saved = false;
      await act(async () => {
        saved = await result.current.overwriteCaption();
      });

      expect(saved).toBe(true);
      expect(saveCaption).toHaveBeenLastCalledWith(`${HOME_PATH}\\sunset.png`, "Mine", {
        baseRevision: "elsewhere",
      });
      expect(result.current.caption).toBe("Mine");
    });
  });

  describe("unreadable captions", () => {
    const unreadable = {
      description: null,
      has_description: false,
      caption_status: "unreadable" as const,
      caption_read_error: "encoding" as const,
      caption_revision: "bytes",
    };

    it("never offers an unreadable caption as an empty one to type over", async () => {
      vi.spyOn(api, "fetchCaption").mockResolvedValue(captionResponse("", unreadable));
      const saveCaption = vi.spyOn(api, "saveCaption");
      const item = makeItem("sunset.png", unreadable);
      const onCaptionSaved = vi.fn<(path: string, update: CaptionSaveResponse) => void>();
      const { result } = renderHook(() => useGalleryItemCaption({ item, onCaptionSaved }));

      expect(result.current.captionLocked).toBe(true);
      expect(result.current.readError).toBe("encoding");
      act(() => result.current.handleCaptionChange("Typed over it"));
      await act(() => result.current.flushPendingSave());

      expect(result.current.caption).toBe("");
      expect(saveCaption).not.toHaveBeenCalled();
    });

    it("replaces it only when asked, against the revision of its bytes", async () => {
      vi.spyOn(api, "fetchCaption").mockResolvedValue(captionResponse("", unreadable));
      const saveCaption = vi
        .spyOn(api, "saveCaption")
        .mockResolvedValue(captionResponse("A new caption", { caption_revision: "new" }));
      const item = makeItem("sunset.png", unreadable);
      const onCaptionSaved = vi.fn<(path: string, update: CaptionSaveResponse) => void>();
      const { result } = renderHook(() => useGalleryItemCaption({ item, onCaptionSaved }));

      act(() => result.current.replaceUnreadableCaption());
      act(() => result.current.handleCaptionChange("A new caption"));
      await act(() => result.current.flushPendingSave());

      expect(saveCaption).toHaveBeenCalledWith(`${HOME_PATH}\\sunset.png`, "A new caption", {
        baseRevision: "bytes",
      });
      expect(result.current.captionLocked).toBe(false);
    });
  });
});
