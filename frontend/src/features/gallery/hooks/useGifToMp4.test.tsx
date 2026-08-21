import { StrictMode, type ReactNode } from "react";
import { act, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { convertGifToMp4, fetchGifToMp4State } from "@/features/gallery/api/gifToMp4";
import { useGifToMp4, type UseGifToMp4Options } from "./useGifToMp4";
import { NotificationsProvider } from "@/shared/notifications/NotificationsProvider";
import { makeItem } from "@/test/galleryItemModal";
import { HOME_PATH } from "@/test/fixtures";
import type { GifToMp4Response } from "@/shared/types";

vi.mock("@/features/gallery/api/gifToMp4", () => ({
  fetchGifToMp4State: vi.fn(),
  convertGifToMp4: vi.fn(),
}));

const fetchStateMock = vi.mocked(fetchGifToMp4State);
const convertMock = vi.mocked(convertGifToMp4);

const GIF = `${HOME_PATH}\\loop.gif`;
const MP4 = `${HOME_PATH}\\loop.mp4`;

const CONVERTED: GifToMp4Response = {
  path: MP4,
  size: 4096,
  modified_at: "2026-03-15T15:00:00.000Z",
  frame_rate: 24,
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <NotificationsProvider>{children}</NotificationsProvider>
    </StrictMode>
  );
}

function renderConversion(overrides: Partial<UseGifToMp4Options> = {}) {
  const onConverted = vi.fn();
  const initial: UseGifToMp4Options = {
    item: makeItem("loop.gif", { media_type: "gif" }),
    onConverted,
    ...overrides,
  };

  const view = renderHook((props: UseGifToMp4Options) => useGifToMp4(props), {
    wrapper,
    initialProps: initial,
  });

  return { ...view, onConverted, initial };
}

beforeEach(() => {
  fetchStateMock.mockReset().mockResolvedValue({ path: GIF, target: MP4, target_exists: false });
  convertMock.mockReset().mockResolvedValue(CONVERTED);
});

describe("useGifToMp4", () => {
  it("converts straight away when nothing holds the name", async () => {
    const { result, onConverted } = renderConversion();

    act(() => result.current.convert());

    await waitFor(() => expect(convertMock).toHaveBeenCalledWith(GIF, false));
    expect(result.current.conflict).toBeNull();
    await waitFor(() => expect(onConverted).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.converting).toBe(false));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved loop.mp4 at 24 fps.");
  });

  it("asks before replacing an MP4 that already sits beside the GIF", async () => {
    fetchStateMock.mockResolvedValue({ path: GIF, target: MP4, target_exists: true });
    const { result } = renderConversion();

    act(() => result.current.convert());

    await waitFor(() => expect(result.current.conflict).toBe("loop.mp4"));
    expect(convertMock).not.toHaveBeenCalled();
    // The prompt is not work in flight: the button has to come back for the answer.
    expect(result.current.converting).toBe(false);
  });

  it("sends the overwrite only once the prompt is confirmed", async () => {
    fetchStateMock.mockResolvedValue({ path: GIF, target: MP4, target_exists: true });
    const { result, onConverted } = renderConversion();

    act(() => result.current.convert());
    await waitFor(() => expect(result.current.conflict).toBe("loop.mp4"));

    act(() => result.current.confirmOverwrite());

    await waitFor(() => expect(convertMock).toHaveBeenCalledWith(GIF, true));
    expect(result.current.conflict).toBeNull();
    await waitFor(() => expect(onConverted).toHaveBeenCalledTimes(1));
  });

  it("writes nothing when the prompt is dismissed", async () => {
    fetchStateMock.mockResolvedValue({ path: GIF, target: MP4, target_exists: true });
    const { result } = renderConversion();

    act(() => result.current.convert());
    await waitFor(() => expect(result.current.conflict).toBe("loop.mp4"));

    act(() => result.current.cancelOverwrite());

    expect(result.current.conflict).toBeNull();
    expect(convertMock).not.toHaveBeenCalled();
  });

  it("drops a pending prompt when the modal moves to another item", async () => {
    fetchStateMock.mockResolvedValue({ path: GIF, target: MP4, target_exists: true });
    const { result, rerender, initial } = renderConversion();

    act(() => result.current.convert());
    await waitFor(() => expect(result.current.conflict).toBe("loop.mp4"));

    rerender({ ...initial, item: makeItem("second.gif", { media_type: "gif" }) });

    expect(result.current.conflict).toBeNull();
    // Confirming a prompt the user can no longer see must not write the file it named.
    act(() => result.current.confirmOverwrite());
    expect(convertMock).not.toHaveBeenCalled();
  });

  it("converts the item it was clicked on, even after the modal advances", async () => {
    let release = () => {};
    convertMock.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return CONVERTED;
    });

    const { result, rerender, initial } = renderConversion();

    act(() => result.current.convert());
    await waitFor(() => expect(convertMock).toHaveBeenCalledWith(GIF, false));

    rerender({ ...initial, item: makeItem("second.gif", { media_type: "gif" }) });
    await act(async () => {
      release();
    });

    expect(convertMock).toHaveBeenCalledTimes(1);
    expect(convertMock).toHaveBeenCalledWith(GIF, false);
  });

  it("ignores a second click while one conversion is still running", async () => {
    let release = () => {};
    convertMock.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return CONVERTED;
    });

    const { result } = renderConversion();

    act(() => result.current.convert());
    await waitFor(() => expect(result.current.converting).toBe(true));
    act(() => result.current.convert());

    await act(async () => {
      release();
    });

    expect(convertMock).toHaveBeenCalledTimes(1);
  });

  it("reports a failed conversion and comes back out of the busy state", async () => {
    convertMock.mockRejectedValue(new Error("ffmpeg is required to convert a GIF"));
    const { result, onConverted } = renderConversion();

    act(() => result.current.convert());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not convert loop.gif: ffmpeg is required to convert a GIF",
    );
    await waitFor(() => expect(result.current.converting).toBe(false));
    expect(onConverted).not.toHaveBeenCalled();
  });

  it("reports a failure to read where the MP4 would land", async () => {
    fetchStateMock.mockRejectedValue(new Error("Media file not found"));
    const { result } = renderConversion();

    act(() => result.current.convert());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not convert loop.gif: Media file not found",
    );
    expect(convertMock).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.converting).toBe(false));
  });
});
