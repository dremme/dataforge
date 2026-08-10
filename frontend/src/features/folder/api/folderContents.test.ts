import { afterEach, describe, expect, it, vi } from "vitest";

const { requestJsonMock } = vi.hoisted(() => ({
  requestJsonMock: vi.fn(),
}));

vi.mock("@/shared/api/http", () => ({
  requestJson: requestJsonMock,
}));

import { serverEventsTabId } from "@/shared/api/eventStream";
import { fetchFolder, fetchFolderFingerprint, fetchSubfolderStats } from "./folderContents";

/** Every folder request carries it: that is what registers this tab's interest. */
const tab = () => `tab=${serverEventsTabId()}`;

describe("folder API", () => {
  afterEach(() => {
    requestJsonMock.mockReset();
  });

  it("fetches the default folder response without a path", async () => {
    requestJsonMock.mockResolvedValue({ folder: "C:\\Photos", images: [] });

    await fetchFolder();

    expect(requestJsonMock).toHaveBeenCalledWith(`/api/folders/contents?${tab()}`, {
      signal: undefined,
    });
  });

  it("fetches a specific folder", async () => {
    requestJsonMock.mockResolvedValue({ folder: "C:\\Photos", images: [] });

    await fetchFolder("C:\\Photos\\Vacation");

    expect(requestJsonMock).toHaveBeenCalledWith(
      `/api/folders/contents?path=C%3A%5CPhotos%5CVacation&${tab()}`,
      {
        signal: undefined,
      },
    );
  });

  it("fetches a folder fingerprint", async () => {
    requestJsonMock.mockResolvedValue({ fingerprint: "abc123" });

    await fetchFolderFingerprint("C:\\Photos");

    expect(requestJsonMock).toHaveBeenCalledWith(
      `/api/folders/fingerprint?path=C%3A%5CPhotos&${tab()}`,
      { signal: undefined },
    );
  });

  it("fetches subfolder stats for a folder", async () => {
    requestJsonMock.mockResolvedValue({ folder: "C:\\Photos", subfolders: [] });

    await fetchSubfolderStats("C:\\Photos");

    expect(requestJsonMock).toHaveBeenCalledWith(
      "/api/folders/subfolder-stats?path=C%3A%5CPhotos",
      {
        signal: undefined,
      },
    );
  });

  it("passes an abort signal through to the request", async () => {
    const controller = new AbortController();
    requestJsonMock.mockResolvedValue({ folder: "C:\\Photos", items: [] });

    await fetchFolder("C:\\Photos", controller.signal);

    expect(requestJsonMock).toHaveBeenCalledWith(
      `/api/folders/contents?path=C%3A%5CPhotos&${tab()}`,
      {
        signal: controller.signal,
      },
    );
  });
});
