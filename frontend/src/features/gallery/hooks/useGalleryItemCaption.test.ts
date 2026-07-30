import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/features/gallery/api/captions";
import { HOME_PATH } from "@/test/fixtures";
import type { CaptionSaveResponse, GalleryItem } from "@/shared/types";
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
    has_issue_file: false,
    has_bboxes: false,
    caption_status: "text",
    caption_file_type: "txt",
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
    caption_file_type: "txt",
    caption_content: `${description}\n`,
    has_bboxes: false,
    bboxes: [],
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
    const onCaptionSaved = vi.fn();

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

  it("syncs browse caption updates without re-fetching when there are no local edits", async () => {
    const fetchCaption = vi
      .spyOn(api, "fetchCaption")
      .mockResolvedValue(captionResponse("Fresh caption"));
    const onCaptionSaved = vi.fn();

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

  it("keeps local edits when browse caption updates arrive in the background", async () => {
    vi.spyOn(api, "fetchCaption").mockResolvedValue(captionResponse("Fresh caption"));
    const onCaptionSaved = vi.fn();

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
    const onCaptionSaved = vi.fn();

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

  it("keeps cached browse data when the refresh request fails", async () => {
    vi.spyOn(api, "fetchCaption").mockRejectedValue(new Error("Network error"));
    const onCaptionSaved = vi.fn();

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

  it("preserves saved feedback when browse echoes the saved caption", async () => {
    vi.spyOn(api, "fetchCaption").mockResolvedValue(captionResponse("Fresh caption"));
    vi.spyOn(api, "saveCaption").mockResolvedValue(captionResponse("Edited caption"));
    const onCaptionSaved = vi.fn();

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
      result.current.handleCaptionChange("Edited caption");
    });

    await waitFor(() => {
      expect(result.current.saveState).toBe("saved");
    });

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
    const onCaptionSaved = vi.fn();
    const item = makeItem("sunset.png", { description: "Fresh caption" });

    const { result } = renderHook(() => useGalleryItemCaption({ item, onCaptionSaved }));

    await waitFor(() => {
      expect(result.current.caption).toBe("Fresh caption");
    });

    act(() => {
      result.current.handleCaptionChange("Hello");
    });

    await waitFor(() => {
      expect(saveCaption).toHaveBeenCalledWith(`${HOME_PATH}\\sunset.png`, "Hello", undefined);
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
    const onCaptionSaved = vi.fn();

    const { result, rerender } = renderHook(
      ({ item }: { item: GalleryItem }) => useGalleryItemCaption({ item, onCaptionSaved }),
      { initialProps: { item: makeItem("sunset.png", { description: "Hello" }) } },
    );

    await waitFor(() => {
      expect(result.current.caption).toBe("Hello");
    });

    act(() => {
      result.current.handleCaptionChange("Hello world");
    });

    await waitFor(() => {
      expect(result.current.saveState).toBe("saved");
    });

    // The poller reloaded the folder from a response older than the save.
    rerender({ item: makeItem("sunset.png", { description: "Hello" }) });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.caption).toBe("Hello world");
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
    const onCaptionSaved = vi.fn();
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
    const onCaptionSaved = vi.fn();

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
    const onCaptionSaved = vi.fn();

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
      expect(saveCaption).toHaveBeenCalledWith(
        `${HOME_PATH}\\sunset.png`,
        "Edited caption",
        undefined,
      );
    });
  });

  it("keeps caption content and bbox selection after saving bbox edits", async () => {
    const bboxes = [
      { x1: 10, y1: 10, x2: 40, y2: 40, label: "Car" },
      { x1: 50, y1: 50, x2: 90, y2: 90, label: "Tree" },
    ];
    const jsonContent = '{\n  "description": "Scene with regions",\n  "elements": []\n}\n';

    vi.spyOn(api, "fetchCaption").mockResolvedValue(
      captionResponse("Scene with regions", {
        caption_file_type: "json",
        caption_file: `${HOME_PATH}\\scene.json`,
        caption_content: jsonContent,
        has_bboxes: true,
        bboxes,
      }),
    );
    vi.spyOn(api, "saveCaption").mockImplementation(async (_path, text, nextBboxes) =>
      captionResponse(text, {
        caption_file_type: "json",
        caption_file: `${HOME_PATH}\\scene.json`,
        caption_content: jsonContent,
        has_bboxes: true,
        bboxes: nextBboxes ?? bboxes,
      }),
    );
    const onCaptionSaved = vi.fn();

    const { result, rerender } = renderHook(
      ({ item }: { item: GalleryItem }) =>
        useGalleryItemCaption({
          item,
          onCaptionSaved,
        }),
      {
        initialProps: {
          item: makeItem("scene.png", {
            description: "Scene with regions",
            caption_file_type: "json",
            has_bboxes: true,
            bboxes,
          }),
        },
      },
    );

    await waitFor(() => {
      expect(result.current.captionContent).toBe(jsonContent);
      expect(result.current.bboxes).toHaveLength(2);
    });

    act(() => {
      result.current.setSelectedBboxIndex(0);
    });
    expect(result.current.selectedBboxIndex).toBe(0);

    const moved = [{ ...bboxes[0], x1: 12, x2: 42 }, bboxes[1]];

    act(() => {
      result.current.handleBboxesChange(moved);
    });

    await waitFor(() => {
      expect(result.current.saveState).toBe("saved");
    });

    rerender({
      item: makeItem("scene.png", {
        description: "Scene with regions",
        caption_file_type: "json",
        has_bboxes: true,
        bboxes: moved,
      }),
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.selectedBboxIndex).toBe(0);
    expect(result.current.captionContent).toBe(jsonContent);
    expect(result.current.hasJsonCaption).toBe(true);
  });
});
