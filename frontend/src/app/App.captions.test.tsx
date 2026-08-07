import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { installMockBackend } from "@/test/mockBackend";
import { renderApp } from "@/test/renderApp";

describe("App: captions", () => {
  it("opens and edits the system prompt modal", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Edit instructions" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Edit instructions" }));

    const dialog = await screen.findByRole("dialog", { name: "Edit system prompt" });
    const editor = within(dialog).getByRole("textbox", { name: "System prompt" });
    expect(within(dialog).getByRole("heading", { name: ".sysprompt" })).toBeInTheDocument();
    expect(editor).toHaveValue("Caption every image with rich detail.");

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

    // The caption save is debounced by 500ms, so this waits out a real timer.
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
