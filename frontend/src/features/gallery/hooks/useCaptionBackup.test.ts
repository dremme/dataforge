import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/features/gallery/api/captions";
import { HOME_PATH } from "@/test/fixtures";
import { useCaptionBackup } from "./useCaptionBackup";

const MEDIA_PATH = `${HOME_PATH}\\sunset.png`;

describe("useCaptionBackup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the backed up caption", async () => {
    vi.spyOn(api, "fetchCaptionBackup").mockResolvedValue({
      exists: true,
      description: "Backed up caption.",
    });

    const { result } = renderHook(() => useCaptionBackup(MEDIA_PATH, true));

    await waitFor(() => expect(result.current).toBe("Backed up caption."));
  });

  it("stays null when the folder has no backup of the file", async () => {
    const fetchBackup = vi
      .spyOn(api, "fetchCaptionBackup")
      .mockResolvedValue({ exists: false, description: null });

    const { result } = renderHook(() => useCaptionBackup(MEDIA_PATH, true));

    await waitFor(() => expect(fetchBackup).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("does not ask the server when the folder has no backup at all", () => {
    const fetchBackup = vi.spyOn(api, "fetchCaptionBackup");

    renderHook(() => useCaptionBackup(MEDIA_PATH, false));

    expect(fetchBackup).not.toHaveBeenCalled();
  });

  it("drops the previous file's backup while the next one loads", async () => {
    vi.spyOn(api, "fetchCaptionBackup").mockResolvedValue({
      exists: true,
      description: "First caption.",
    });

    const { result, rerender } = renderHook(({ path }) => useCaptionBackup(path, true), {
      initialProps: { path: MEDIA_PATH },
    });

    await waitFor(() => expect(result.current).toBe("First caption."));

    vi.spyOn(api, "fetchCaptionBackup").mockResolvedValue({ exists: false, description: null });
    rerender({ path: `${HOME_PATH}\\harbour.png` });

    expect(result.current).toBeNull();
  });
});
