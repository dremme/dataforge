import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FolderFavorite } from "@/shared/types";

const { fetchFolderFavoritesMock } = vi.hoisted(() => ({
  fetchFolderFavoritesMock: vi.fn(),
}));

const { addFolderFavoriteMock, removeFolderFavoriteMock } = vi.hoisted(() => ({
  addFolderFavoriteMock: vi.fn(),
  removeFolderFavoriteMock: vi.fn(),
}));

vi.mock("@/features/folder/api/folders", () => ({
  fetchFolderFavorites: fetchFolderFavoritesMock,
  addFolderFavorite: addFolderFavoriteMock,
  removeFolderFavorite: removeFolderFavoriteMock,
}));

import {
  cacheFolderFavorites,
  getCachedFolderFavorites,
  optimisticallyAddFavorite,
  optimisticallyRemoveFavorite,
  refreshFolderFavoritesInBackground,
  syncAddFolderFavorite,
} from "./folderFavorites";

const sampleFavorites: FolderFavorite[] = [
  { name: "Home", path: "C:\\Photos" },
  { name: "Vacation", path: "C:\\Photos\\Vacation" },
];

describe("folderFavorites", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchFolderFavoritesMock.mockReset();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("reads and writes favorites from localStorage", () => {
    cacheFolderFavorites(sampleFavorites);

    expect(getCachedFolderFavorites()).toEqual(sampleFavorites);
    expect(JSON.parse(localStorage.getItem("gallery-folder-favorites") ?? "[]")).toEqual(
      sampleFavorites,
    );
  });

  it("refreshes favorites in the background and updates cache", async () => {
    cacheFolderFavorites([sampleFavorites[0]]);
    fetchFolderFavoritesMock.mockResolvedValue({ favorites: sampleFavorites });

    const onUpdated = vi.fn();

    refreshFolderFavoritesInBackground(onUpdated);

    await vi.waitFor(() => {
      expect(onUpdated).toHaveBeenCalledWith(sampleFavorites);
    });

    expect(getCachedFolderFavorites()).toEqual(sampleFavorites);
  });

  it("adds and removes favorites optimistically", () => {
    const withVacation = optimisticallyAddFavorite([sampleFavorites[0]], "C:\\Photos\\Vacation");
    expect(withVacation).toHaveLength(2);

    const withoutVacation = optimisticallyRemoveFavorite(withVacation, "C:\\Photos\\Vacation");
    expect(withoutVacation).toEqual([sampleFavorites[0]]);
  });

  it("syncs favorites with the backend after optimistic cache updates", async () => {
    cacheFolderFavorites([sampleFavorites[0]]);
    addFolderFavoriteMock.mockResolvedValue({ favorites: sampleFavorites });

    const synced = await syncAddFolderFavorite("C:\\Photos\\Vacation");

    expect(synced).toEqual(sampleFavorites);
    expect(getCachedFolderFavorites()).toEqual(sampleFavorites);
    expect(addFolderFavoriteMock).toHaveBeenCalledWith("C:\\Photos\\Vacation");
  });
});
