import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HOME_PATH, homeFolder } from "@/test/fixtures";
import { installMockBackend } from "@/test/mockBackend";
import { renderApp } from "@/test/renderApp";

/** The app opens the server's default folder, so both entries carry the note. */
function homeWithNote(note: string) {
  const folder = { ...homeFolder, note };
  return { folderByPath: { undefined: folder, [HOME_PATH]: folder } };
}

function notePuts(fetchMock: ReturnType<typeof installMockBackend>["fetchMock"]) {
  return fetchMock.mock.calls
    .filter(
      ([input, init]) => String(input).startsWith("/api/folder-note") && init?.method === "PUT",
    )
    .map(([input, init]) => ({
      path: new URL(String(input), "http://localhost").searchParams.get("path"),
      text: JSON.parse(String(init?.body)).text,
    }));
}

describe("App: folder note", () => {
  it("adds a note from the sidebar and shows it above the gallery", async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "Add note" }));
    const dialog = await screen.findByRole("dialog", { name: "Add note" });
    await user.type(within(dialog).getByRole("textbox", { name: "Note" }), "Reshoot the dusk set.");
    await user.click(within(dialog).getByRole("button", { name: "Save note" }));

    const banner = await screen.findByRole("complementary", { name: "Folder note" });
    expect(banner).toHaveTextContent("Reshoot the dusk set.");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit note" })).toBeInTheDocument();
    expect(notePuts(fetchMock)).toEqual([{ path: HOME_PATH, text: "Reshoot the dusk set." }]);
  });

  it("deletes the note only after confirmation", async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockBackend(homeWithNote("Check the crops."));
    await renderApp();

    const banner = await screen.findByRole("complementary", { name: "Folder note" });
    await user.click(within(banner).getByRole("button", { name: "Delete note" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Delete this note?" });
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(notePuts(fetchMock)).toEqual([]);
    expect(banner).toBeInTheDocument();

    await user.click(within(banner).getByRole("button", { name: "Delete note" }));
    await user.click(
      within(await screen.findByRole("alertdialog", { name: "Delete this note?" })).getByRole(
        "button",
        { name: "Delete note" },
      ),
    );

    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: "Folder note" })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "Add note" })).toBeInTheDocument();
    expect(notePuts(fetchMock)).toEqual([{ path: HOME_PATH, text: "" }]);
  });

  it("does not show a parent's note in a subfolder", async () => {
    const user = userEvent.setup();
    installMockBackend(homeWithNote("Parent only."));
    await renderApp();

    await screen.findByRole("complementary", { name: "Folder note" });
    await user.click(await screen.findByRole("button", { name: /Vacation/ }));

    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: "Folder note" })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "Add note" })).toBeInTheDocument();
  });
});
