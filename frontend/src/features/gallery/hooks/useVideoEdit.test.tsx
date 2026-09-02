import { StrictMode, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchVideoEditState } from "@/features/gallery/api/videoEdit";
import { useVideoEdit, type UseVideoEditOptions } from "./useVideoEdit";
import { AppProviders } from "@/test/AppProviders";
import { makeItem } from "@/test/galleryItemModal";
import { HOME_PATH } from "@/test/fixtures";
import type { VideoEditStateResponse } from "@/shared/types";

vi.mock("@/features/gallery/api/videoEdit", () => ({
  videoOriginalUrl: (path: string) => `/api/media?path=${path}&original=1`,
  fetchVideoEditState: vi.fn(),
  applyVideoEdit: vi.fn(),
  cancelVideoEdit: vi.fn(),
  revertVideoEdit: vi.fn(),
}));

const fetchStateMock = vi.mocked(fetchVideoEditState);

const CLIP = `${HOME_PATH}\\clip.mp4`;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <AppProviders>{children}</AppProviders>
    </StrictMode>
  );
}

function videoMeta(duration: number): HTMLVideoElement {
  return {
    duration,
    videoWidth: 1920,
    videoHeight: 1080,
    pause() {},
    currentTime: 0,
    muted: true,
  } as HTMLVideoElement;
}

function renderEdit(overrides: Partial<UseVideoEditOptions> = {}) {
  const setEditMode = vi.fn();
  const initial: UseVideoEditOptions = {
    item: makeItem("clip.mp4", { media_type: "video" }),
    videoRef: { current: null },
    editMode: true,
    setEditMode,
    ...overrides,
  };

  const view = renderHook((props: UseVideoEditOptions) => useVideoEdit(props), {
    wrapper,
    initialProps: initial,
  });

  return { ...view, setEditMode, initial };
}

beforeEach(() => {
  fetchStateMock.mockReset().mockResolvedValue({
    path: CLIP,
    has_backup: false,
    spec: null,
  } satisfies VideoEditStateResponse);
});

describe("useVideoEdit", () => {
  it("keeps an in-progress draft when duration updates after the first real value", async () => {
    const { result } = renderEdit();

    await act(async () => {
      result.current.handleLoadedMetadata(videoMeta(12));
    });
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => {
      result.current.setTrimStart(2);
      result.current.setTrimEnd(8);
    });

    const fetches = fetchStateMock.mock.calls.length;

    await act(async () => {
      result.current.handleLoadedMetadata(videoMeta(12.04));
    });

    expect(result.current.draft.trimStart).toBe(2);
    expect(result.current.draft.trimEnd).toBe(8);
    expect(fetchStateMock.mock.calls.length).toBe(fetches);
  });

  it("re-opens on the blur regions stored beside the file", async () => {
    fetchStateMock.mockResolvedValue({
      path: CLIP,
      has_backup: true,
      spec: {
        masks: [{ x: 0.1, y: 0.1, width: 0.3, height: 0.3, mode: "pixelate", strength: 0.22 }],
        trim_start: 0,
        trim_end: null,
        crop: null,
        speed: 1,
        scale: 1,
        volume: 1,
        brightness: 1,
        contrast: 1,
        saturation: 1,
        warmth: 0,
        hue: 0,
      },
    });
    const { result } = renderEdit();

    await act(async () => {
      result.current.handleLoadedMetadata(videoMeta(12));
    });

    await waitFor(() => expect(result.current.draft.masks).toHaveLength(1));
    expect(result.current.draft.masks[0]).toMatchObject({ mode: "pixelate", strength: 0.22 });
    expect(result.current.dirty).toBe(false);
  });

  it("moves the draft volume, and re-opens on a stored one", async () => {
    fetchStateMock.mockResolvedValue({
      path: CLIP,
      has_backup: true,
      spec: {
        masks: [],
        trim_start: 0,
        trim_end: null,
        crop: null,
        speed: 1,
        scale: 1,
        volume: 0,
        brightness: 1,
        contrast: 1,
        saturation: 1,
        warmth: 0,
        hue: 0,
      },
    });
    const { result } = renderEdit();

    await act(async () => {
      result.current.handleLoadedMetadata(videoMeta(12));
    });

    await waitFor(() => expect(result.current.draft.volume).toBe(0));
    expect(result.current.dirty).toBe(false);

    act(() => result.current.setVolume(1.5));
    expect(result.current.draft.volume).toBe(1.5);
    expect(result.current.dirty).toBe(true);
  });

  it("moves and restores the draft colors", async () => {
    fetchStateMock.mockResolvedValue({
      path: CLIP,
      has_backup: true,
      spec: {
        masks: [],
        trim_start: 0,
        trim_end: null,
        crop: null,
        speed: 1,
        scale: 1,
        volume: 1,
        brightness: 1.2,
        contrast: 0.8,
        saturation: 1.5,
        warmth: 0.4,
        hue: 30,
      },
    });
    const { result } = renderEdit();

    await act(async () => {
      result.current.handleLoadedMetadata(videoMeta(12));
    });

    await waitFor(() => expect(result.current.draft.brightness).toBe(1.2));
    expect(result.current.draft.hue).toBe(30);

    act(() => {
      result.current.setBrightness(1.4);
      result.current.setContrast(0.9);
      result.current.setSaturation(1.2);
      result.current.setWarmth(-0.2);
      result.current.setHue(45);
    });
    expect(result.current.draft).toMatchObject({
      brightness: 1.4,
      contrast: 0.9,
      saturation: 1.2,
      warmth: -0.2,
      hue: 45,
    });

    act(() => result.current.resetColor());
    expect(result.current.draft).toMatchObject({
      brightness: 1,
      contrast: 1,
      saturation: 1,
      warmth: 0,
      hue: 0,
    });
  });

  it("still seeds once Infinity becomes a real duration", async () => {
    fetchStateMock.mockResolvedValue({
      path: CLIP,
      has_backup: true,
      spec: {
        masks: [],
        trim_start: 3,
        trim_end: 9,
        crop: null,
        speed: 1,
        scale: 1,
        volume: 1,
        brightness: 1,
        contrast: 1,
        saturation: 1,
        warmth: 0,
        hue: 0,
      },
    });
    const { result } = renderEdit();

    await act(async () => {
      result.current.handleLoadedMetadata(videoMeta(Number.POSITIVE_INFINITY));
    });
    expect(result.current.ready).toBe(false);

    await act(async () => {
      result.current.handleLoadedMetadata(videoMeta(12));
    });

    await waitFor(() => expect(result.current.draft.trimStart).toBe(3));
    expect(result.current.draft.trimEnd).toBe(9);
  });
  it("ignores the edited file's duration when edit mode opens on the original", async () => {
    // Browsing plays the already-shortened file; editing swaps in the untouched original.
    const { result, rerender, initial } = renderEdit({ editMode: false });

    await act(async () => {
      result.current.handleLoadedMetadata(videoMeta(6));
    });

    rerender({ ...initial, editMode: true });

    await act(async () => {
      result.current.handleLoadedMetadata(videoMeta(12));
    });

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.duration).toBe(12);
    expect(result.current.draft.trimEnd).toBe(12);
  });
});
