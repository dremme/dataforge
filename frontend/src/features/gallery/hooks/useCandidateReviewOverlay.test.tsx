import { StrictMode, type ReactNode } from "react";
import { act, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFolder } from "@/features/folder/api/folderContents";
import { NotificationsProvider } from "@/shared/notifications/NotificationsProvider";
import type { FolderResponse, GalleryItem } from "@/shared/types";
import { HOME_PATH, mediaItem } from "@/test/fixtures";
import { useCandidateReviewOverlay } from "./useCandidateReviewOverlay";

vi.mock("@/features/folder/api/folderContents", () => ({
  fetchFolder: vi.fn(),
}));

const fetchFolderMock = vi.mocked(fetchFolder);

const STAGING_PATH = `${HOME_PATH}\\staging`;

function stagingListing(items: GalleryItem[]): FolderResponse {
  return {
    folder: STAGING_PATH,
    items,
    subfolders: [],
    breadcrumbs: [],
    fingerprint: "fp",
    has_caption_backup: false,
  } as unknown as FolderResponse;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <NotificationsProvider>{children}</NotificationsProvider>
    </StrictMode>
  );
}

describe("useCandidateReviewOverlay", () => {
  beforeEach(() => {
    fetchFolderMock.mockReset();
  });

  it("pairs each candidate with the dataset image of the same name", async () => {
    const source = mediaItem("lake.png", HOME_PATH, {
      width: 512,
      height: 512,
      has_candidate: true,
      candidate_name: "lake.png",
    });
    const candidate = mediaItem("lake.png", STAGING_PATH, { width: 1024, height: 1024 });
    fetchFolderMock.mockResolvedValue(stagingListing([candidate]));

    const { result } = renderHook(() => useCandidateReviewOverlay(), { wrapper });

    await act(async () => {
      await result.current.openCandidateReview(HOME_PATH, [source]);
    });

    await waitFor(() => expect(result.current.open).toBe(true));
    expect(result.current.entries).toHaveLength(1);
    // Every candidate call names the source path, not the staged one.
    expect(result.current.entries[0].path).toBe(`${HOME_PATH}\\lake.png`);
    expect(result.current.entries[0].source).toBe(source);
    expect(result.current.entries[0].candidate.width).toBe(1024);
  });

  it("keeps a candidate whose source is gone, rather than hiding it", async () => {
    const candidate = mediaItem("orphan.png", STAGING_PATH);
    fetchFolderMock.mockResolvedValue(stagingListing([candidate]));

    const { result } = renderHook(() => useCandidateReviewOverlay(), { wrapper });

    await act(async () => {
      await result.current.openCandidateReview(HOME_PATH, []);
    });

    await waitFor(() => expect(result.current.open).toBe(true));
    expect(result.current.entries[0].source).toBeNull();
  });

  it("says so instead of opening an empty queue", async () => {
    fetchFolderMock.mockResolvedValue(stagingListing([]));

    const { result } = renderHook(() => useCandidateReviewOverlay(), { wrapper });

    await act(async () => {
      await result.current.openCandidateReview(HOME_PATH, []);
    });

    expect(result.current.open).toBe(false);
    expect(await screen.findByText("No candidates are waiting for review.")).toBeInTheDocument();
  });

  it("treats a staging folder that was never created as nothing to review", async () => {
    // The ordinary case before any run, not a failure worth an error toast.
    fetchFolderMock.mockRejectedValue(new Error("Folder not found"));

    const { result } = renderHook(() => useCandidateReviewOverlay(), { wrapper });

    await act(async () => {
      await result.current.openCandidateReview(HOME_PATH, []);
    });

    expect(result.current.open).toBe(false);
    expect(await screen.findByText("No candidates are waiting for review.")).toBeInTheDocument();
  });

  it("reports a real failure", async () => {
    fetchFolderMock.mockRejectedValue(new Error("Disk on fire"));

    const { result } = renderHook(() => useCandidateReviewOverlay(), { wrapper });

    await act(async () => {
      await result.current.openCandidateReview(HOME_PATH, []);
    });

    expect(result.current.open).toBe(false);
    expect(await screen.findByText("Disk on fire")).toBeInTheDocument();
  });

  it("refreshes the folder on close, not after every decision", async () => {
    const onResolved = vi.fn();
    fetchFolderMock.mockResolvedValue(stagingListing([mediaItem("a.png", STAGING_PATH)]));

    const { result } = renderHook(() => useCandidateReviewOverlay(onResolved), { wrapper });

    await act(async () => {
      await result.current.openCandidateReview(HOME_PATH, []);
    });
    expect(onResolved).not.toHaveBeenCalled();

    act(() => result.current.closeCandidateReview());

    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(result.current.open).toBe(false);
    expect(result.current.entries).toHaveLength(0);
  });

  it("lists the folder's staging subfolder", async () => {
    fetchFolderMock.mockResolvedValue(stagingListing([mediaItem("a.png", STAGING_PATH)]));

    const { result } = renderHook(() => useCandidateReviewOverlay(), { wrapper });

    await act(async () => {
      await result.current.openCandidateReview(HOME_PATH, []);
    });

    expect(fetchFolderMock).toHaveBeenCalledWith(STAGING_PATH);
  });

  describe("focused on one file", () => {
    const lake = mediaItem("lake.png", HOME_PATH, {
      has_candidate: true,
      candidate_name: "lake.png",
    });
    const ridge = mediaItem("ridge.png", HOME_PATH, {
      has_candidate: true,
      candidate_name: "ridge.png",
    });

    beforeEach(() => {
      fetchFolderMock.mockResolvedValue(
        stagingListing([mediaItem("lake.png", STAGING_PATH), mediaItem("ridge.png", STAGING_PATH)]),
      );
    });

    it("queues only that file's candidate", async () => {
      const { result } = renderHook(() => useCandidateReviewOverlay(), { wrapper });

      await act(async () => {
        await result.current.openCandidateReview(HOME_PATH, [lake, ridge], {
          path: ridge.path,
          onOpen: vi.fn(),
        });
      });

      expect(result.current.entries.map((entry) => entry.path)).toEqual([ridge.path]);
    });

    it("hands over only once the queue is ready, so a failed listing leaves the file open", async () => {
      fetchFolderMock.mockRejectedValue(new Error("Disk on fire"));
      const onOpen = vi.fn();
      const { result } = renderHook(() => useCandidateReviewOverlay(), { wrapper });

      await act(async () => {
        await result.current.openCandidateReview(HOME_PATH, [lake], { path: lake.path, onOpen });
      });

      expect(onOpen).not.toHaveBeenCalled();
      expect(result.current.open).toBe(false);
    });

    it("says so when that file's candidate is already gone", async () => {
      fetchFolderMock.mockResolvedValue(stagingListing([mediaItem("ridge.png", STAGING_PATH)]));
      const onOpen = vi.fn();
      const { result } = renderHook(() => useCandidateReviewOverlay(), { wrapper });

      await act(async () => {
        await result.current.openCandidateReview(HOME_PATH, [lake, ridge], {
          path: lake.path,
          onOpen,
        });
      });

      expect(onOpen).not.toHaveBeenCalled();
      expect(result.current.open).toBe(false);
      expect(await screen.findByText("No candidate is waiting for lake.png.")).toBeInTheDocument();
    });

    it("returns to the file on close", async () => {
      const onReturnToItem = vi.fn();
      const { result } = renderHook(() => useCandidateReviewOverlay(vi.fn(), onReturnToItem), {
        wrapper,
      });

      await act(async () => {
        await result.current.openCandidateReview(HOME_PATH, [lake], {
          path: lake.path,
          onOpen: vi.fn(),
        });
      });
      act(() => result.current.closeCandidateReview());

      expect(onReturnToItem).toHaveBeenCalledExactlyOnceWith(lake.path);
    });

    it("does not return anywhere after a folder-wide review", async () => {
      const onReturnToItem = vi.fn();
      const { result } = renderHook(() => useCandidateReviewOverlay(vi.fn(), onReturnToItem), {
        wrapper,
      });

      await act(async () => {
        await result.current.openCandidateReview(HOME_PATH, [lake]);
      });
      act(() => result.current.closeCandidateReview());

      expect(onReturnToItem).not.toHaveBeenCalled();
    });
  });
});
