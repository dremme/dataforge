import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/features/folder/api/folderContents";
import { FOLDER_NOT_FOUND_MESSAGE } from "@/shared/api/http";
import { HOME_PATH, VACATION_PATH } from "@/test/fixtures";
import {
  fetchFolderWithRetry,
  getRecentFoldersForPicker,
  promoteRecentFolder,
  readRecentFolderPaths,
  touchRecentFolder,
} from "./folderPreferences";

describe("fetchFolderWithRetry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not retry when the folder is not found", async () => {
    const fetchFolder = vi
      .spyOn(api, "fetchFolder")
      .mockRejectedValue(new Error(FOLDER_NOT_FOUND_MESSAGE));

    await expect(fetchFolderWithRetry(HOME_PATH)).rejects.toThrow(FOLDER_NOT_FOUND_MESSAGE);
    expect(fetchFolder).toHaveBeenCalledTimes(1);
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

  it("promotes an unfavorited folder to the top of recent", () => {
    touchRecentFolder(HOME_PATH);
    touchRecentFolder(VACATION_PATH);

    promoteRecentFolder(HOME_PATH);

    expect(readRecentFolderPaths()).toEqual([HOME_PATH, VACATION_PATH]);
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
