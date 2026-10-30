import { act, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as MediaApi from "@/features/gallery/api/media";
import { openMediaInViewer, renameMedia } from "@/features/gallery/api/media";
import type { WorkspaceAction } from "@/app/hooks/useWorkspaceTransitions";
import { AppProviders } from "@/test/AppProviders";
import { HOME_PATH } from "@/test/fixtures";
import { makeItem } from "@/test/galleryItemDialog";
import type { GalleryCardAction, GalleryItem } from "@/shared/types";
import { useGalleryCardActions } from "./useGalleryCardActions";

vi.mock("@/features/gallery/api/media", async (importOriginal) => ({
  ...(await importOriginal<typeof MediaApi>()),
  openMediaInViewer: vi.fn<typeof openMediaInViewer>(),
  renameMedia: vi.fn<typeof renameMedia>(),
}));

const viewerMock = vi.mocked(openMediaInViewer);
const renameMock = vi.mocked(renameMedia);

const ITEM = makeItem("photo.png");

function handlers() {
  return {
    openItem: vi.fn<(path: string, mode?: "edit" | "frame") => void>(),
    openInVideoEditor: vi.fn<(path: string) => void>(),
    startTransferFor: vi.fn<(path: string, mode: "move" | "copy") => void>(),
    openDeleteConfirmFor: vi.fn<(path: string) => void>(),
    onResolveIssue: vi.fn<(item: GalleryItem) => void>(),
    onReviewCandidate: vi.fn<(item: GalleryItem) => void>(),
    onResolveDuplicate: vi.fn<(item: GalleryItem) => void>(),
    onRenamed: vi.fn<(path: string, renamedPath: string) => void>(),
  };
}

function renderActions(
  requestTransition: (action: WorkspaceAction) => Promise<void> = async (action) => {
    await action();
  },
) {
  const options = handlers();
  const hook = renderHook(
    (current: ReturnType<typeof handlers>) =>
      useGalleryCardActions({ requestTransition, ...current }),
    { wrapper: AppProviders, initialProps: options },
  );
  return { ...hook, options };
}

describe("useGalleryCardActions", () => {
  beforeEach(() => {
    viewerMock.mockReset().mockResolvedValue(undefined as never);
    renameMock.mockReset();
  });

  it("keeps one handler while the handlers behind it change", () => {
    const { result, rerender } = renderActions();
    const { run } = result.current;
    const next = handlers();

    rerender(next);

    expect(result.current.run).toBe(run);
    act(() => result.current.run("delete", ITEM));
    expect(next.openDeleteConfirmFor).toHaveBeenCalledWith(ITEM.path);
  });

  it.each([
    ["open_in_video_editor", "openInVideoEditor", [ITEM.path]],
    ["copy_file", "startTransferFor", [ITEM.path, "copy"]],
    ["move_file", "startTransferFor", [ITEM.path, "move"]],
    ["delete", "openDeleteConfirmFor", [ITEM.path]],
    ["resolve_issue", "onResolveIssue", [ITEM]],
    ["review_candidate", "onReviewCandidate", [ITEM]],
    ["resolve_duplicate", "onResolveDuplicate", [ITEM]],
  ] as const)("%s waits for the transition", async (action, handler, args) => {
    let release: WorkspaceAction = () => {};
    const { result, options } = renderActions(async (next) => {
      release = next;
    });

    act(() => result.current.run(action as GalleryCardAction, ITEM));
    await act(async () => {});
    expect(options[handler]).not.toHaveBeenCalled();

    await act(async () => {
      await release();
    });
    expect(options[handler]).toHaveBeenCalledWith(...args);
  });

  it("opens the viewer in the mode asked for", () => {
    const { result, options } = renderActions();

    act(() => result.current.run("edit", ITEM));
    act(() => result.current.run("save_frame", ITEM));

    expect(options.openItem).toHaveBeenNthCalledWith(1, ITEM.path, "edit");
    expect(options.openItem).toHaveBeenNthCalledWith(2, ITEM.path, "frame");
  });

  it("says when the image preview would not open", async () => {
    viewerMock.mockRejectedValue(new Error("No viewer"));
    const { result } = renderActions();

    act(() => result.current.run("open_in_image_preview", ITEM));

    expect(await screen.findByText("No viewer")).toBeInTheDocument();
  });

  it("opens Rename only after the transition", async () => {
    let release: WorkspaceAction = () => {};
    const { result } = renderActions(async (next) => {
      release = next;
    });

    act(() => result.current.run("rename_file", ITEM));
    await act(async () => {});
    expect(result.current.renameFile).toBeNull();

    await act(async () => {
      await release();
    });
    expect(result.current.renameFile?.fileName).toBe("photo.png");
  });

  it("renames the card's file and reports where it went", async () => {
    const renamed = `${HOME_PATH}\\lake.png`;
    renameMock.mockResolvedValue({ destination: renamed } as never);
    const { result, options } = renderActions();

    act(() => result.current.run("rename_file", ITEM));
    await waitFor(() => expect(result.current.renameFile).not.toBeNull());
    await act(() => result.current.renameFile!.onConfirm("lake"));

    expect(renameMock).toHaveBeenCalledWith(ITEM.path, "lake");
    expect(options.onRenamed).toHaveBeenCalledWith(ITEM.path, renamed);
    expect(result.current.renameFile).toBeNull();
  });

  it("keeps Rename open with the reason when it fails", async () => {
    renameMock.mockRejectedValue(new Error("Name taken"));
    const { result, options } = renderActions();

    act(() => result.current.run("rename_file", ITEM));
    await waitFor(() => expect(result.current.renameFile).not.toBeNull());
    await act(() => result.current.renameFile!.onConfirm("lake"));

    expect(result.current.renameFile?.error).toBe("Name taken");
    expect(result.current.renameFile?.busy).toBe(false);
    expect(options.onRenamed).not.toHaveBeenCalled();
  });

  it("forgets the last failure when Rename opens again", async () => {
    renameMock.mockRejectedValue(new Error("Name taken"));
    const { result } = renderActions();

    act(() => result.current.run("rename_file", ITEM));
    await waitFor(() => expect(result.current.renameFile).not.toBeNull());
    await act(() => result.current.renameFile!.onConfirm("lake"));
    act(() => result.current.renameFile!.onCancel());
    expect(result.current.renameFile).toBeNull();

    act(() => result.current.run("rename_file", ITEM));
    await waitFor(() => expect(result.current.renameFile).not.toBeNull());

    expect(result.current.renameFile?.error).toBeNull();
  });
});
