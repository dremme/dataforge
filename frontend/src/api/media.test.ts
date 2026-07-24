import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteMedia,
  deleteSelectedMedia,
  mediaUrl,
  openMediaInViewer,
  thumbnailUrl,
} from "./media";
import { requestJson } from "./http";

vi.mock("./http", () => ({
  requestJson: vi.fn(),
}));

const requestJsonMock = vi.mocked(requestJson);

describe("openMediaInViewer", () => {
  beforeEach(() => {
    requestJsonMock.mockReset();
  });

  it("sends an open request for the media path", async () => {
    requestJsonMock.mockResolvedValue({
      path: "C:\\Photos\\sunset.png",
    });

    await openMediaInViewer("C:\\Photos\\sunset.png");

    expect(requestJsonMock).toHaveBeenCalledWith(
      "/api/media/open?path=C%3A%5CPhotos%5Csunset.png",
      { method: "POST" },
    );
  });
});

describe("deleteMedia", () => {
  beforeEach(() => {
    requestJsonMock.mockReset();
  });

  it("sends a delete request for the media path", async () => {
    requestJsonMock.mockResolvedValue({
      path: "C:\\Photos\\sunset.png",
      deleted: ["sunset.png", "sunset.txt"],
    });

    await deleteMedia("C:\\Photos\\sunset.png");

    expect(requestJsonMock).toHaveBeenCalledWith("/api/media?path=C%3A%5CPhotos%5Csunset.png", {
      method: "DELETE",
    });
  });
});

describe("deleteSelectedMedia", () => {
  beforeEach(() => {
    requestJsonMock.mockReset();
  });

  it("deletes each path and returns successes and failures separately", async () => {
    requestJsonMock.mockImplementation(async (url: string) => {
      if (url.includes("beach.jpg")) {
        throw new Error("Permission denied");
      }

      return {
        path: decodeURIComponent(url.split("path=")[1] ?? ""),
        deleted: ["file"],
      };
    });

    const result = await deleteSelectedMedia([
      "C:\\Photos\\sunset.png",
      "C:\\Photos\\beach.jpg",
      "C:\\Photos\\lake.png",
    ]);

    expect(requestJsonMock).toHaveBeenCalledTimes(3);
    expect(result.succeeded).toEqual(["C:\\Photos\\sunset.png", "C:\\Photos\\lake.png"]);
    expect(result.failed).toEqual([{ path: "C:\\Photos\\beach.jpg", error: expect.any(Error) }]);
  });
});

describe("mediaUrl", () => {
  it("builds a media endpoint URL with the encoded path", () => {
    const url = mediaUrl("C:\\Photos\\sunset.png");
    expect(url).toBe("/api/media?path=C%3A%5CPhotos%5Csunset.png");
  });
});

describe("thumbnailUrl", () => {
  it("builds thumbnail URLs with width and cache busting", () => {
    const url = thumbnailUrl("C:\\Photos\\sunset.png", 400, "1718798400000-4096");
    expect(url).toContain("/api/thumbnail?");
    expect(url).toContain("path=C%3A%5CPhotos%5Csunset.png");
    expect(url).toContain("w=400");
    expect(url).toContain("v=1718798400000-4096");
  });

  it("omits the cache token when none is provided", () => {
    const url = thumbnailUrl("C:\\Photos\\sunset.png");
    expect(url).toContain("w=400");
    expect(url).not.toContain("v=");
  });
});
