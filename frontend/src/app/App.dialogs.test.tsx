import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { VACATION_PATH } from "@/test/fixtures";
import { installMockBackend } from "@/test/mockBackend";
import { renderApp } from "@/test/renderApp";

describe("App: dialogs", () => {
  it("shows favorites and lets recent folders be starred in the folder picker", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Open folder" }));

    const dialog = await screen.findByRole("dialog", { name: "Open folder" });

    await waitFor(() => {
      expect(within(dialog).getByRole("region", { name: "Favorites" })).toBeInTheDocument();
    });

    expect(
      within(dialog).getByRole("button", { name: "Remove Home from favorites" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Vacation/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View lake.png" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Photos" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Open folder" }));

    const reopenedDialog = await screen.findByRole("dialog", { name: "Open folder" });

    await waitFor(() => {
      expect(
        within(reopenedDialog).getByRole("region", { name: "Recent folders" }),
      ).toBeInTheDocument();
      expect(
        within(reopenedDialog).getByRole("button", { name: "Add Vacation to favorites" }),
      ).toBeInTheDocument();
    });

    await user.click(
      within(reopenedDialog).getByRole("button", { name: "Add Vacation to favorites" }),
    );

    await waitFor(() => {
      expect(
        within(reopenedDialog).getByRole("button", { name: "Remove Vacation from favorites" }),
      ).toBeInTheDocument();
      expect(
        within(reopenedDialog).queryByRole("button", { name: "Add Vacation to favorites" }),
      ).not.toBeInTheDocument();
    });

    await user.click(
      within(reopenedDialog).getByRole("button", { name: "Remove Vacation from favorites" }),
    );

    await waitFor(() => {
      expect(
        within(reopenedDialog).getByRole("button", { name: "Add Vacation to favorites" }),
      ).toBeInTheDocument();
    });

    const recentSection = within(reopenedDialog).getByRole("region", { name: "Recent folders" });
    const firstRecentName = recentSection.querySelector(
      ".open-folder-modal__option-name",
    )?.textContent;
    expect(firstRecentName).toBe("Vacation");
  });

  it("opens a folder from the folder picker", async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open folder" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Open folder" }));

    const dialog = await screen.findByRole("dialog", { name: "Open folder" });
    const pathInput = within(dialog).getByRole("textbox", { name: "Folder path" });
    await user.clear(pathInput);
    await user.type(pathInput, VACATION_PATH);
    await user.click(within(dialog).getByRole("button", { name: "Open" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View lake.png" })).toBeInTheDocument();
    });

    expect(
      fetchMock.mock.calls.some(([input]) => {
        const requestUrl =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        return (
          new URL(requestUrl, "http://localhost").pathname === "/api/folders/contents" &&
          new URL(requestUrl, "http://localhost").searchParams.get("path") === VACATION_PATH
        );
      }),
    ).toBe(true);
  });

  it("scopes a job dialog to the selection when one is active", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "Select" }));
    await user.click(screen.getByRole("button", { name: "Select sunset.png" }));

    await user.click(screen.getByRole("button", { name: /Auto-caption/ }));

    const dialog = await screen.findByRole("alertdialog", { name: "Start auto-caption?" });
    expect(dialog.querySelector(".dialog-scope__line")).toHaveTextContent(
      "1 selected file in Photos",
    );
  });

  it("asks for confirmation before starting an auto-caption job", async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Auto-caption/ })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Auto-caption/ }));

    const dialog = await screen.findByRole("alertdialog", { name: "Start auto-caption?" });
    expect(dialog.querySelector(".dialog-scope__line")).toHaveTextContent(
      /^All \d+ files? in Photos$/,
    );

    expect(screen.getByRole("radio", { name: /Reasoning/i })).toBeChecked();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input]) => {
        const requestUrl =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        return new URL(requestUrl, "http://localhost").pathname === "/api/auto-caption";
      }),
    ).toBe(false);

    await user.click(screen.getByRole("button", { name: /Auto-caption/ }));
    await screen.findByRole("alertdialog", { name: "Start auto-caption?" });

    const instructRadio = screen.getByRole("radio", { name: /Instruct/i });
    await user.click(instructRadio);
    expect(instructRadio).toBeChecked();

    const audioCheckbox = screen.getByRole("checkbox", { name: "Caption audio" });
    expect(audioCheckbox).not.toBeChecked();
    await user.click(audioCheckbox);

    await user.click(screen.getByRole("button", { name: /Start auto-caption/i }));

    await waitFor(() => {
      const autoCalls = fetchMock.mock.calls.filter(([input, init]) => {
        const requestUrl =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const url = new URL(requestUrl, "http://localhost");
        return (
          url.pathname === "/api/automation/auto-caption" &&
          (init?.method ?? "GET").toUpperCase() === "POST"
        );
      });
      expect(autoCalls.length).toBeGreaterThan(0);
      const last = autoCalls[autoCalls.length - 1];
      const init = last[1];
      const body = init?.body ? JSON.parse(init.body as string) : {};
      expect(body.mode).toBe("instruct");
      expect(body.caption_audio).toBe(true);
    });
  });
});
