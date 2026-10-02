import { afterEach, describe, expect, it } from "vitest";
import type { FolderFavorite } from "@/shared/types";
import {
  cacheFolderFavorites,
  optimisticallyAddFavorite,
  optimisticallyRemoveFavorite,
  readCachedFolderFavorites,
} from "./folderFavorites";

const sampleFavorites: FolderFavorite[] = [
  { name: "Home", path: "C:\\Photos" },
  { name: "Vacation", path: "C:\\Photos\\Vacation" },
];

describe("folderFavorites", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("reads and writes favorites from localStorage", () => {
    cacheFolderFavorites(sampleFavorites);

    expect(readCachedFolderFavorites()).toEqual(sampleFavorites);
    expect(JSON.parse(localStorage.getItem("gallery-folder-favorites") ?? "[]")).toEqual(
      sampleFavorites,
    );
  });

  it("ignores malformed entries in the mirror", () => {
    localStorage.setItem(
      "gallery-folder-favorites",
      JSON.stringify([sampleFavorites[0], { name: 3 }, "C:\\Other"]),
    );

    expect(readCachedFolderFavorites()).toEqual([sampleFavorites[0]]);
  });

  it("adds and removes favorites optimistically", () => {
    const withVacation = optimisticallyAddFavorite([sampleFavorites[0]], "C:\\Photos\\Vacation");
    expect(withVacation).toHaveLength(2);

    const withoutVacation = optimisticallyRemoveFavorite(withVacation, "C:\\Photos\\Vacation");
    expect(withoutVacation).toEqual([sampleFavorites[0]]);
  });
});
