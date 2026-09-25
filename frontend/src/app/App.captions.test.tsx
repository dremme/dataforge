import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HOME_PATH, HOME_SYSPROMPT, VACATION_PATH } from "@/test/fixtures";
import { installMockBackend } from "@/test/mockBackend";
import { renderApp } from "@/test/renderApp";

describe("App: captions", () => {
  it("lets a subfolder start its own system prompt from the one it inherits", async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: /Vacation/ }));
    await user.click(await screen.findByRole("button", { name: "Create instructions" }));

    const dialog = await screen.findByRole("dialog", { name: "Folder instructions" });
    const editor = await within(dialog).findByRole("textbox", { name: "System prompt" });
    expect(editor).toHaveValue("");
    expect(within(dialog).getByText("..\\.sysprompt")).toHaveAttribute("title", HOME_PATH);

    await user.click(within(dialog).getByRole("button", { name: "Copy from parent" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("button", { name: "Edit instructions" })).toBeInTheDocument();
    const saved = fetchMock.mock.calls.find(
      ([input, init]) => String(input).startsWith("/api/sysprompt") && init?.method === "PUT",
    );
    expect(new URL(String(saved?.[0]), "http://localhost").searchParams.get("path")).toBe(
      VACATION_PATH,
    );
  });

  it("opens the folder instructions and edits the system prompt", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Edit instructions" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Edit instructions" }));

    const dialog = await screen.findByRole("dialog", { name: "Folder instructions" });
    const editor = await within(dialog).findByRole("textbox", { name: "System prompt" });
    expect(
      within(dialog).getByRole("heading", { name: "Folder instructions" }),
    ).toBeInTheDocument();
    expect(editor).toHaveValue(`${HOME_SYSPROMPT}\n`);

    await user.clear(editor);
    await user.type(editor, "New folder prompt.");

    await waitFor(() => {
      expect(editor).toHaveValue("New folder prompt.");
    });
  });

  it("keeps the gallery modal open after captioning on the missing-caption filter", async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View beach.jpg" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Filter media" }));
    await user.click(await screen.findByRole("menuitemradio", { name: /Missing caption \(\d+\)/ }));

    await user.click(screen.getByRole("button", { name: "View beach.jpg" }));

    const dialog = await screen.findByRole("dialog", { name: "Viewing beach.jpg" });
    const caption = within(dialog).getByRole("textbox", { name: "Caption for beach.jpg" });
    await user.type(caption, "Sandy shoreline at dusk.");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/caption"),
        expect.objectContaining({ method: "PUT" }),
      );
    });

    expect(screen.getByRole("dialog", { name: "Viewing beach.jpg" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View beach.jpg" })).not.toBeInTheDocument();
  });
});
