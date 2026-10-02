import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/features/folder/api/folderContents";
import { NetworkError } from "@/shared/api/http";
import { HOME_PATH, VACATION_PATH, homeFolder, vacationFolder } from "@/test/fixtures";
import {
  getCachedLastFolder,
  getRecentFoldersForPicker,
  loadFolderContents,
  readRecentFolderPaths,
  rememberOpenedFolder,
  touchRecentFolder,
} from "./folderPreferences";

describe("loadFolderContents", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("leaves the last and recent folders alone: listing is not opening", async () => {
    vi.spyOn(api, "fetchFolder").mockResolvedValue(vacationFolder);

    await loadFolderContents(VACATION_PATH);

    expect(getCachedLastFolder()).toBeNull();
    expect(readRecentFolderPaths()).toEqual([]);
  });

  it("falls back to the last folder when the default cannot be listed", async () => {
    rememberOpenedFolder(HOME_PATH);
    const fetchFolder = vi
      .spyOn(api, "fetchFolder")
      .mockRejectedValueOnce(new NetworkError())
      .mockResolvedValueOnce(homeFolder);

    await expect(loadFolderContents()).resolves.toBe(homeFolder);
    expect(fetchFolder).toHaveBeenLastCalledWith(HOME_PATH, {});
  });

  it("gives up on the default when there is no last folder to fall back to", async () => {
    vi.spyOn(api, "fetchFolder").mockRejectedValue(new NetworkError());

    await expect(loadFolderContents()).rejects.toBeInstanceOf(NetworkError);
  });
});

describe("folderPreferences recent folders", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("keeps the most recently touched folder first", () => {
    touchRecentFolder(HOME_PATH);
    touchRecentFolder(VACATION_PATH);
    touchRecentFolder(HOME_PATH);

    expect(readRecentFolderPaths()).toEqual([HOME_PATH, VACATION_PATH]);
  });

  it("deduplicates paths that only differ by slash direction", () => {
    touchRecentFolder("C:/Photos/Vacation");
    touchRecentFolder(VACATION_PATH);

    expect(readRecentFolderPaths()).toEqual([VACATION_PATH]);
  });

  it("puts the current folder first in the picker when it is not a favorite", () => {
    touchRecentFolder(HOME_PATH);
    touchRecentFolder(VACATION_PATH);

    expect(getRecentFoldersForPicker(VACATION_PATH, [])).toEqual([VACATION_PATH, HOME_PATH]);
  });

  it("omits the current folder from recent in the picker when it is a favorite", () => {
    touchRecentFolder(VACATION_PATH);
    touchRecentFolder(HOME_PATH);

    expect(getRecentFoldersForPicker(HOME_PATH, [HOME_PATH])).toEqual([VACATION_PATH]);
  });
});
