import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_PATH, VACATION_PATH } from "@/test/fixtures";
import { cacheFolderFavorites } from "@/features/folder/lib/folderFavorites";
import {
  clearRecentFolders,
  readRecentFolderPaths,
  touchRecentFolder,
} from "@/features/folder/lib/folderPreferences";

const { fetchFolderFavoritesMock, addFolderFavoriteMock, removeFolderFavoriteMock } = vi.hoisted(
  () => ({
    fetchFolderFavoritesMock: vi.fn(),
    addFolderFavoriteMock: vi.fn(),
    removeFolderFavoriteMock: vi.fn(),
  }),
);

vi.mock("@/features/folder/api/folders", () => ({
  fetchFolderFavorites: fetchFolderFavoritesMock,
  addFolderFavorite: addFolderFavoriteMock,
  removeFolderFavorite: removeFolderFavoriteMock,
}));

import { renderWithProviders } from "@/test/renderWithProviders";
import { OpenFolderModal } from "./OpenFolderModal";

const render = renderWithProviders;

describe("OpenFolderModal", () => {
  beforeEach(() => {
    localStorage.clear();
    cacheFolderFavorites([{ name: "Home", path: HOME_PATH }]);
    touchRecentFolder(VACATION_PATH);

    fetchFolderFavoritesMock.mockReset();
    addFolderFavoriteMock.mockReset();
    removeFolderFavoriteMock.mockReset();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("unlocks every folder after overlapping favorite toggles settle", async () => {
    const user = userEvent.setup();
    const home = { name: "Home", path: HOME_PATH };
    const vacation = { name: "Vacation", path: VACATION_PATH };
    cacheFolderFavorites([home, vacation]);
    fetchFolderFavoritesMock.mockResolvedValue({ favorites: [home, vacation] });
    type Favorites = { favorites: (typeof home)[] };
    let finishFirst!: (value: Favorites) => void;
    let finishSecond!: (value: Favorites) => void;
    const first = new Promise<Favorites>((resolve) => {
      finishFirst = resolve;
    });
    const second = new Promise<Favorites>((resolve) => {
      finishSecond = resolve;
    });
    removeFolderFavoriteMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
    addFolderFavoriteMock.mockResolvedValue({ favorites: [home] });
    render(<OpenFolderModal currentFolder={HOME_PATH} onClose={vi.fn()} onOpenFolder={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Remove Home from favorites" }));
    await waitFor(() => expect(removeFolderFavoriteMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Remove Vacation from favorites" }));
    await waitFor(() => expect(removeFolderFavoriteMock).toHaveBeenCalledTimes(2));
    await act(async () => {
      finishFirst({ favorites: [vacation] });
      await first;
    });
    await act(async () => {
      finishSecond({ favorites: [] });
      await second;
    });
    await user.click(await screen.findByRole("button", { name: "Add Photos to favorites" }));
    await waitFor(() => expect(addFolderFavoriteMock).toHaveBeenCalledWith(HOME_PATH));
  });

  it("preserves another removed favorite's recent shortcut when a toggle fails", async () => {
    const user = userEvent.setup();
    const home = { name: "Home", path: HOME_PATH };
    const vacation = { name: "Vacation", path: VACATION_PATH };
    clearRecentFolders();
    cacheFolderFavorites([home, vacation]);
    fetchFolderFavoritesMock.mockResolvedValue({ favorites: [home, vacation] });
    type Favorites = { favorites: (typeof home)[] };
    let failFirst!: (error: Error) => void;
    let finishSecond!: (value: Favorites) => void;
    removeFolderFavoriteMock
      .mockReturnValueOnce(
        new Promise<Favorites>((_resolve, reject) => {
          failFirst = reject;
        }),
      )
      .mockReturnValueOnce(
        new Promise<Favorites>((resolve) => {
          finishSecond = resolve;
        }),
      );
    render(<OpenFolderModal currentFolder={HOME_PATH} onClose={vi.fn()} onOpenFolder={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Remove Home from favorites" }));
    await user.click(screen.getByRole("button", { name: "Remove Vacation from favorites" }));
    await waitFor(() => expect(removeFolderFavoriteMock).toHaveBeenCalledTimes(2));
    await act(async () => finishSecond({ favorites: [home] }));
    await act(async () => failFirst(new Error("Could not save favorite")));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Remove Home from favorites" }),
      ).toBeInTheDocument(),
    );
    expect(readRecentFolderPaths()).toContain(VACATION_PATH);
    expect(screen.getByRole("button", { name: "Add Vacation to favorites" })).toBeInTheDocument();
  });

  it("does not let a stale background refresh overwrite an optimistic favorite toggle", async () => {
    const user = userEvent.setup();

    let resolveFetch!: (value: { favorites: { name: string; path: string }[] }) => void;
    fetchFolderFavoritesMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    addFolderFavoriteMock.mockResolvedValue({
      favorites: [
        { name: "Home", path: HOME_PATH },
        { name: "Vacation", path: VACATION_PATH },
      ],
    });

    render(<OpenFolderModal currentFolder={HOME_PATH} onClose={vi.fn()} onOpenFolder={vi.fn()} />);

    const dialog = await screen.findByRole("dialog", { name: "Open folder" });
    const recentSection = within(dialog).getByRole("region", { name: "Recent folders" });

    await user.click(
      within(recentSection).getByRole("button", { name: "Add Vacation to favorites" }),
    );

    await waitFor(() => {
      expect(
        within(dialog).getByRole("button", { name: "Remove Vacation from favorites" }),
      ).toBeInTheDocument();
    });

    resolveFetch({ favorites: [{ name: "Home", path: HOME_PATH }] });

    await waitFor(() => {
      expect(fetchFolderFavoritesMock).toHaveBeenCalled();
    });

    expect(
      within(dialog).getByRole("button", { name: "Remove Vacation from favorites" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Add Vacation to favorites" }),
    ).not.toBeInTheDocument();
  });
});
