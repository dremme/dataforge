import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HOME_PATH, VACATION_PATH, homeFolder } from "@/test/fixtures";
import { touchRecentFolder } from "@/features/folder/lib/folderPreferences";
import { installMockBackend } from "@/test/mockBackend";
import { renderApp } from "@/test/renderApp";

async function openLintDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /More/ }));
  await user.click(screen.getByRole("menuitem", { name: /Lint captions/ }));
  return screen.findByRole("alertdialog", { name: "Lint captions?" });
}

describe("App: dialogs", () => {
  it("shows favorites and lets a recent folder be starred in the folder picker", async () => {
    const user = userEvent.setup();
    installMockBackend();
    touchRecentFolder(VACATION_PATH);
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "Open folder" }));

    const dialog = await screen.findByRole("dialog", { name: "Open folder" });
    const favoritesSection = await within(dialog).findByRole("region", { name: "Favorites" });
    expect(
      within(favoritesSection).getByRole("button", { name: "Remove Home from favorites" }),
    ).toBeInTheDocument();

    const recentSection = within(dialog).getByRole("region", { name: "Recent folders" });
    await user.click(
      within(recentSection).getByRole("button", { name: "Add Vacation to favorites" }),
    );

    await waitFor(() => {
      expect(
        within(dialog).getByRole("button", { name: "Remove Vacation from favorites" }),
      ).toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: "Add Vacation to favorites" }),
      ).not.toBeInTheDocument();
    });

    await user.click(
      within(dialog).getByRole("button", { name: "Remove Vacation from favorites" }),
    );

    await waitFor(() => {
      expect(
        within(dialog).queryByRole("button", { name: "Remove Vacation from favorites" }),
      ).not.toBeInTheDocument();
    });
    expect(within(dialog).getByRole("region", { name: "Recent folders" })).toContainElement(
      within(dialog).getByRole("button", { name: "Add Vacation to favorites" }),
    );
  });

  it("lists a folder opened from the gallery under recent folders in the picker", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: /Vacation/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View lake.png" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Photos" }));
    await user.click(await screen.findByRole("button", { name: "Open folder" }));

    const dialog = await screen.findByRole("dialog", { name: "Open folder" });
    const recentSection = await within(dialog).findByRole("region", { name: "Recent folders" });
    expect(
      within(recentSection).getByRole("button", { name: "Add Vacation to favorites" }),
    ).toBeInTheDocument();
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

  it("keeps linting disabled while no caption rules apply to the folder", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    const dialog = await openLintDialog(user);
    expect(dialog.querySelector(".dialog-scope__line")).toHaveTextContent(
      /^All \d+ files? in Photos$/,
    );
    await within(dialog).findByText(/No caption rules apply to this folder yet/);
    expect(within(dialog).getByRole("button", { name: "Lint captions" })).toBeDisabled();
  });

  it("lints once caption rules were written in the folder instructions", async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "Edit instructions" }));
    const editor = await screen.findByRole("dialog", { name: "Folder instructions" });
    await user.click(within(editor).getByRole("tab", { name: "Caption rules" }));
    await user.click(await within(editor).findByRole("button", { name: "Use template" }));
    await user.click(within(editor).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Folder instructions" })).toBeNull();
    });

    const ready = await openLintDialog(user);
    expect(await within(ready).findByText(".captionrules")).toBeInTheDocument();
    await user.click(within(ready).getByRole("button", { name: "Lint captions" }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map(([input, init]) => {
        const requestUrl =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        return `${(init?.method ?? "GET").toUpperCase()} ${new URL(requestUrl, "http://localhost").pathname}`;
      });
      const saved = calls.indexOf("PUT /api/caption-rules");
      const started = calls.indexOf("POST /api/automation/check-caption-rules");
      expect(saved).toBeGreaterThanOrEqual(0);
      expect(started).toBeGreaterThan(saved);
    });
  });

  it("offers to edit the instructions once the folder has caption rules of its own", async () => {
    const user = userEvent.setup();
    const withoutSysprompt = { ...homeFolder, has_sysprompt: false, sysprompt_applies: false };
    installMockBackend({
      folderByPath: { undefined: withoutSysprompt, [HOME_PATH]: withoutSysprompt },
    });
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "Create instructions" }));
    const editor = await screen.findByRole("dialog", { name: "Folder instructions" });
    await user.click(within(editor).getByRole("tab", { name: "Caption rules" }));
    await user.click(await within(editor).findByRole("button", { name: "Use template" }));
    await user.click(within(editor).getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("button", { name: "Edit instructions" })).toBeInTheDocument();
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
