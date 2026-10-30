import { act, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as MediaApi from "@/features/gallery/api/media";
import { previewMediaTransfer, transferSelectedMedia } from "@/features/gallery/api/media";
import { AppProviders } from "@/test/AppProviders";
import { HOME_PATH } from "@/test/fixtures";
import { useMediaTransfer } from "./useMediaTransfer";

vi.mock("@/features/gallery/api/media", async (importOriginal) => ({
  ...(await importOriginal<typeof MediaApi>()),
  previewMediaTransfer: vi.fn<typeof previewMediaTransfer>(),
  transferSelectedMedia: vi.fn<typeof transferSelectedMedia>(),
}));

const previewMock = vi.mocked(previewMediaTransfer);
const transferMock = vi.mocked(transferSelectedMedia);

const ARCHIVE = `${HOME_PATH}\\Archive`;
const SOURCE = `${HOME_PATH}\\sunset.png`;
const MOVED = `${ARCHIVE}\\sunset.png`;

function renderTransfer() {
  const onMoved = vi.fn<(paths: string[]) => void>();
  const onCopied = vi.fn<() => void>();
  const hook = renderHook(() => useMediaTransfer({ paths: [SOURCE], onMoved, onCopied }), {
    wrapper: AppProviders,
  });
  return { ...hook, onMoved, onCopied };
}

describe("useMediaTransfer picker", () => {
  function renderWithoutPaths() {
    return renderHook(
      () =>
        useMediaTransfer({
          paths: [],
          onMoved: vi.fn<(paths: string[]) => void>(),
          onCopied: vi.fn<() => void>(),
        }),
      { wrapper: AppProviders },
    );
  }

  it("stays closed with nothing to transfer", () => {
    const { result } = renderWithoutPaths();

    act(() => result.current.openTransferPicker("move"));

    expect(result.current.transferPicker).toBeNull();
  });

  it("opens for paths the options have not caught up with yet", () => {
    const { result } = renderWithoutPaths();

    act(() => result.current.openTransferPicker("move", [SOURCE]));

    expect(result.current.transferPicker).toBe("move");
  });
});

describe("useMediaTransfer undo", () => {
  beforeEach(() => {
    previewMock.mockReset();
    transferMock.mockReset();
    transferMock.mockResolvedValue({
      succeeded: [SOURCE],
      skipped: [],
      failed: [],
      transferred: [{ source: SOURCE, destination: MOVED }],
    });
  });

  it("moves the files back to where they came from on Undo", async () => {
    previewMock.mockResolvedValue({ eligible: [SOURCE], conflicts: [], skipped: [] });
    const user = userEvent.setup();
    const { result, onCopied } = renderTransfer();

    act(() => result.current.selectDestination("move", ARCHIVE));
    await user.click(await screen.findByRole("button", { name: "Undo" }));

    await waitFor(() =>
      expect(transferMock).toHaveBeenLastCalledWith("move", HOME_PATH, [MOVED], false),
    );
    await waitFor(() => expect(onCopied).toHaveBeenCalled());
  });

  it("offers no Undo once the move replaced files, which cannot come back", async () => {
    previewMock.mockResolvedValue({ eligible: [], conflicts: [SOURCE], skipped: [] });
    const { result } = renderTransfer();

    act(() => result.current.selectDestination("move", ARCHIVE));
    await waitFor(() => expect(result.current.overwritePrompt).not.toBeNull());
    act(() => result.current.confirmOverwrite(true));

    await waitFor(() => expect(transferMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.transferring).toBeNull());
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
});
