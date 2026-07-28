import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_PATH, VACATION_PATH } from "@/test/fixtures";
import { cacheFolderFavorites } from "@/features/browse/lib/folderFavorites";
import { touchRecentFolder } from "@/features/browse/lib/folderPreferences";

const { fetchFolderFavoritesMock, addFolderFavoriteMock } = vi.hoisted(() => ({
  fetchFolderFavoritesMock: vi.fn(),
  addFolderFavoriteMock: vi.fn(),
}));

vi.mock("@/features/browse/api/folders", () => ({
  fetchFolderFavorites: fetchFolderFavoritesMock,
  addFolderFavorite: addFolderFavoriteMock,
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
  });

  afterEach(() => {
    localStorage.clear();
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
