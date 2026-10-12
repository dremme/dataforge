import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as mediaApi from "@/features/gallery/api/media";
import { renderHookWithQueryClient } from "@/test/queryClient";
import { useGifFrameCount } from "./useGifFrameCount";

vi.mock("@/shared/lib/defer", () => ({
  deferNonCriticalWork: (run: () => void) => run(),
}));

const loop = { path: "C:\\Photos\\loop.gif", modified_at: "2026-06-19T12:00:00+00:00", size: 4096 };

describe("useGifFrameCount", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("counts again when the GIF at the same path is replaced", async () => {
    const fetchInfo = vi
      .spyOn(mediaApi, "fetchGifInfo")
      .mockResolvedValueOnce({ frame_count: 10 })
      .mockResolvedValueOnce({ frame_count: 24 });

    const { result, rerender } = renderHookWithQueryClient(
      ({ item }) => useGifFrameCount(item, true),
      { initialProps: { item: loop } },
    );
    await waitFor(() => expect(result.current).toBe(10));

    rerender({ item: { ...loop, modified_at: "2026-06-19T12:30:00+00:00", size: 8192 } });

    await waitFor(() => expect(result.current).toBe(24));
    expect(fetchInfo).toHaveBeenCalledTimes(2);
  });
});
