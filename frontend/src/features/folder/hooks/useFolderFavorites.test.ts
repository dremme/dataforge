import { focusManager } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/features/folder/api/folders";
import {
  cacheFolderFavorites,
  readCachedFolderFavorites,
} from "@/features/folder/lib/folderFavorites";
import type { FolderFavorite } from "@/shared/types";
import { queryWrapper } from "@/test/queryClient";
import { useFolderFavorites, useToggleFolderFavorite } from "./useFolderFavorites";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const home: FolderFavorite = { name: "Home", path: "C:\\Photos" };
const vacation: FolderFavorite = { name: "Vacation", path: "C:\\Photos\\Vacation" };

function renderFavorites() {
  return renderHook(
    () => ({ favorites: useFolderFavorites().data, toggle: useToggleFolderFavorite() }),
    { wrapper: queryWrapper().wrapper },
  );
}

afterEach(() => {
  focusManager.setFocused(undefined);
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("useFolderFavorites", () => {
  it("lists the mirrored favorites at once, then the server's, and mirrors those", async () => {
    cacheFolderFavorites([home]);
    vi.spyOn(api, "fetchFolderFavorites").mockResolvedValue({ favorites: [home, vacation] });

    const { result } = renderFavorites();

    expect(result.current.favorites).toEqual([home]);
    await waitFor(() => expect(result.current.favorites).toEqual([home, vacation]));
    expect(readCachedFolderFavorites()).toEqual([home, vacation]);
  });

  it("shows a toggle before the server answers and keeps a refresh from undoing it", async () => {
    cacheFolderFavorites([home]);
    let answerRefresh: (value: { favorites: FolderFavorite[] }) => void = () => {};
    vi.spyOn(api, "fetchFolderFavorites").mockReturnValue(
      new Promise((resolve) => (answerRefresh = resolve)),
    );
    vi.spyOn(api, "addFolderFavorite").mockResolvedValue({ favorites: [home, vacation] });

    const { result } = renderFavorites();
    act(() => result.current.toggle.mutate({ path: vacation.path, isFavorite: false }));

    await waitFor(() => expect(result.current.favorites).toEqual([home, vacation]));
    await act(async () => answerRefresh({ favorites: [home] }));

    expect(result.current.favorites).toEqual([home, vacation]);
    expect(api.addFolderFavorite).toHaveBeenCalledWith(vacation.path);
  });

  it("puts the list back when the save fails", async () => {
    cacheFolderFavorites([home, vacation]);
    vi.spyOn(api, "fetchFolderFavorites").mockResolvedValue({ favorites: [home, vacation] });
    vi.spyOn(api, "removeFolderFavorite").mockRejectedValue(new Error("offline"));

    const { result } = renderFavorites();
    await waitFor(() => expect(api.fetchFolderFavorites).toHaveBeenCalled());

    act(() => result.current.toggle.mutate({ path: vacation.path, isFavorite: true }));

    await waitFor(() => expect(result.current.toggle.isError).toBe(true));
    expect(result.current.favorites).toEqual([home, vacation]);
    expect(readCachedFolderFavorites()).toEqual([home, vacation]);
  });
});

it("keeps both folder changes when older favorite replies arrive last", async () => {
  cacheFolderFavorites([home, vacation]);
  vi.spyOn(api, "fetchFolderFavorites").mockResolvedValue({ favorites: [home, vacation] });
  const first = deferred<{ favorites: FolderFavorite[] }>();
  const second = deferred<{ favorites: FolderFavorite[] }>();
  vi.spyOn(api, "removeFolderFavorite")
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const { result } = renderFavorites();
  await waitFor(() => expect(result.current.favorites).toEqual([home, vacation]));
  act(() => result.current.toggle.mutate({ path: home.path, isFavorite: true }));
  await waitFor(() => expect(result.current.favorites).toEqual([vacation]));
  act(() => result.current.toggle.mutate({ path: vacation.path, isFavorite: true }));
  await waitFor(() => expect(result.current.favorites).toEqual([]));
  await act(async () => second.resolve({ favorites: [] }));
  await act(async () => first.resolve({ favorites: [vacation] }));
  await waitFor(() => expect(result.current.favorites).toEqual([]));
  expect(readCachedFolderFavorites()).toEqual([]);
});

it("rolls back only the failed favorite while another removal succeeds", async () => {
  cacheFolderFavorites([home, vacation]);
  vi.spyOn(api, "fetchFolderFavorites").mockResolvedValue({ favorites: [home, vacation] });
  const first = deferred<{ favorites: FolderFavorite[] }>();
  const second = deferred<{ favorites: FolderFavorite[] }>();
  vi.spyOn(api, "removeFolderFavorite")
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const { result } = renderFavorites();
  await waitFor(() => expect(result.current.favorites).toEqual([home, vacation]));
  act(() => result.current.toggle.mutate({ path: home.path, isFavorite: true }));
  await waitFor(() => expect(result.current.favorites).toEqual([vacation]));
  act(() => result.current.toggle.mutate({ path: vacation.path, isFavorite: true }));
  await waitFor(() => expect(result.current.favorites).toEqual([]));
  await act(async () => second.resolve({ favorites: [home] }));
  await act(async () => first.reject(new Error("offline")));
  await waitFor(() => expect(result.current.favorites).toEqual([home]));
  expect(readCachedFolderFavorites()).toEqual([home]);
});

it("shares fresh favorites between pickers, then refreshes on a stale opening", async () => {
  const fetchMock = vi.spyOn(api, "fetchFolderFavorites").mockResolvedValue({ favorites: [home] });
  const { wrapper } = queryWrapper();
  const first = renderHook(() => useFolderFavorites().data, { wrapper });
  await waitFor(() => expect(first.result.current).toEqual([home]));
  first.unmount();
  const second = renderHook(() => useFolderFavorites().data, { wrapper });
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  second.unmount();
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_001);
  fetchMock.mockResolvedValue({ favorites: [home, vacation] });
  const third = renderHook(() => useFolderFavorites().data, { wrapper });
  await waitFor(() => expect(third.result.current).toEqual([home, vacation]));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
