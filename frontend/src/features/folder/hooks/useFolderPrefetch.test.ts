import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/features/folder/api/folderContents";
import { folderKeys } from "@/features/folder/lib/folderQuery";
import { VACATION_PATH, vacationFolder } from "@/test/fixtures";
import { renderHookWithQueryClient } from "@/test/queryClient";
import { PREFETCH_INTENT_MS, useFolderPrefetch } from "./useFolderPrefetch";

describe("useFolderPrefetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(api, "fetchFolder").mockResolvedValue(vacationFolder);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("lists a folder speculatively once the pointer rests on it", async () => {
    const { result, client } = renderHookWithQueryClient(() => useFolderPrefetch());

    act(() => result.current(VACATION_PATH).onPointerEnter());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREFETCH_INTENT_MS);
    });

    expect(api.fetchFolder).toHaveBeenCalledExactlyOnceWith(VACATION_PATH, {
      signal: expect.any(AbortSignal),
      prefetch: true,
    });
    expect(client.getQueryData(folderKeys.folder(VACATION_PATH))).toEqual(vacationFolder);
  });

  it("lists nothing when the pointer only passes over", async () => {
    const { result } = renderHookWithQueryClient(() => useFolderPrefetch());

    act(() => {
      const handlers = result.current(VACATION_PATH);
      handlers.onPointerEnter();
      handlers.onPointerLeave();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREFETCH_INTENT_MS * 2);
    });

    expect(api.fetchFolder).not.toHaveBeenCalled();
  });

  it("leaves a cached folder to be revalidated when it is opened", async () => {
    const { result, client } = renderHookWithQueryClient(() => useFolderPrefetch());
    client.setQueryData(folderKeys.folder(VACATION_PATH), vacationFolder);

    act(() => result.current(VACATION_PATH).onPointerEnter());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREFETCH_INTENT_MS);
    });

    expect(api.fetchFolder).not.toHaveBeenCalled();
  });
});
