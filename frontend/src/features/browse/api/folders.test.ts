import { afterEach, describe, expect, it, vi } from "vitest";

const { requestJsonMock } = vi.hoisted(() => ({
  requestJsonMock: vi.fn(),
}));

vi.mock("@/shared/api/http", () => ({
  requestJson: requestJsonMock,
}));

import {
  addFolderFavorite,
  createFolder,
  fetchFolderChildren,
  fetchFolderFavorites,
  fetchFolderRoots,
  openFolderInExplorer,
  removeFolderFavorite,
} from "./folders";

describe("folders API", () => {
  afterEach(() => {
    requestJsonMock.mockReset();
  });

  it("fetches folder roots", async () => {
    requestJsonMock.mockResolvedValue({ home: "C:\\Users", roots: [] });

    await fetchFolderRoots();

    expect(requestJsonMock).toHaveBeenCalledWith("/api/folders/roots");
  });

  it("fetches child folders for a path", async () => {
    requestJsonMock.mockResolvedValue({
      folder: "C:\\Photos",
      children: [{ name: "Vacation", path: "C:\\Photos\\Vacation" }],
    });

    await fetchFolderChildren("C:\\Photos");

    expect(requestJsonMock).toHaveBeenCalledWith("/api/folders/children?path=C%3A%5CPhotos");
  });

  it("fetches folder favorites", async () => {
    requestJsonMock.mockResolvedValue({ favorites: [] });

    await fetchFolderFavorites();

    expect(requestJsonMock).toHaveBeenCalledWith("/api/folders/favorites");
  });

  it("adds a folder favorite", async () => {
    requestJsonMock.mockResolvedValue({ favorites: [] });

    await addFolderFavorite("C:\\Photos\\Vacation");

    expect(requestJsonMock).toHaveBeenCalledWith(
      "/api/folders/favorites?path=C%3A%5CPhotos%5CVacation",
      { method: "POST" },
    );
  });

  it("removes a folder favorite", async () => {
    requestJsonMock.mockResolvedValue({ favorites: [] });

    await removeFolderFavorite("C:\\Photos\\Vacation");

    expect(requestJsonMock).toHaveBeenCalledWith(
      "/api/folders/favorites?path=C%3A%5CPhotos%5CVacation",
      { method: "DELETE" },
    );
  });

  it("opens a folder in the file manager", async () => {
    requestJsonMock.mockResolvedValue({ path: "C:\\Photos" });

    await openFolderInExplorer("C:\\Photos");

    expect(requestJsonMock).toHaveBeenCalledWith("/api/folders/open?path=C%3A%5CPhotos", {
      method: "POST",
    });
  });

  it("creates a folder in the current directory", async () => {
    requestJsonMock.mockResolvedValue({
      name: "Landscapes",
      path: "C:\\Photos\\Landscapes",
      file_count: 0,
      captioned_count: 0,
      issue_count: 0,
    });

    await createFolder("C:\\Photos", "Landscapes");

    expect(requestJsonMock).toHaveBeenCalledWith(
      "/api/folders/create?path=C%3A%5CPhotos&name=Landscapes",
      { method: "POST" },
    );
  });
});
