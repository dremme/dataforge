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

  it("still seeds once Infinity becomes a real duration", async () => {
    fetchStateMock.mockResolvedValue({
      path: CLIP,
      has_backup: true,
      spec: { masks: [], trim_start: 3, trim_end: 9, crop: null, speed: 1, scale: 1 },
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
});
