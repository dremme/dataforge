import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HOME_PATH, homeFolder } from "@/test/fixtures";
import { installMockBackend } from "@/test/mockBackend";
import { renderApp } from "@/test/renderApp";
import type { FolderResponse } from "@/shared/types";

const issueFolder: FolderResponse = {
  ...homeFolder,
  items: homeFolder.items.map((item) =>
    item.name === "sunset.png"
      ? {
          ...item,
          has_issue_file: true,
          has_duplicate_file: false,
          issue_fixes: ['Replace "lake" with "river".'],
        }
      : item,
  ),
};

function installIssueBackend() {
  return installMockBackend({
    folderByPath: { undefined: issueFolder, [HOME_PATH]: issueFolder },
  });
}

describe("App: gallery item modal", () => {
  it("opens and closes the gallery item modal", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "View sunset.png" }));

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    expect(within(dialog).getByRole("heading", { name: "sunset.png" })).toBeInTheDocument();

    await user.click(within(dialog).getAllByRole("button", { name: "Close" })[0]);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Viewing sunset.png" })).not.toBeInTheDocument();
    });
  });

  it("shows a delete confirmation when deleting from the gallery item modal", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "View sunset.png" }));

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    await user.click(within(dialog).getByRole("button", { name: "Delete sunset.png" }));

    const confirmDialog = await screen.findByRole("alertdialog", { name: "Delete file?" });
    expect(confirmDialog).toBeVisible();
    expect(within(confirmDialog).getByText("sunset.png")).toBeVisible();
  });

  it("moves a file to another folder from the gallery item modal", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "View sunset.png" }));

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    await user.click(
      within(dialog).getByRole("button", { name: "Move sunset.png to another folder" }),
    );

    const picker = await screen.findByRole("dialog", { name: "Move to folder" });
    await user.click(await within(picker).findByRole("button", { name: "Vacation" }));
    await user.click(within(picker).getByRole("button", { name: "Move here" }));

    await screen.findByRole("dialog", { name: "Viewing waves.mp4" });
  });

  it("counts the selection against the visible media while selecting", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Select" }));

    await waitFor(() => {
      expect(screen.getByLabelText("0 of 3")).toHaveClass("gallery-section__count");
    });

    await user.click(screen.getByRole("button", { name: "Select sunset.png" }));
    expect(screen.getByLabelText("1 of 3")).toHaveClass("gallery-section__count");

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByLabelText("3 of 3")).toHaveClass("gallery-section__count");
  });

  it("returns to the gallery item modal after resolving that file's issue", async () => {
    const user = userEvent.setup();
    installIssueBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "View sunset.png" }));

    const modal = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    await user.click(
      within(modal).getByRole("button", { name: "Resolve caption issue for sunset.png" }),
    );

    const resolver = await screen.findByRole("dialog", {
      name: "Resolve caption issue for sunset.png",
    });
    const caption = within(resolver).getByLabelText("Caption for sunset.png");
    await user.clear(caption);
    await user.type(caption, "Golden hour over the river");
    await user.click(within(resolver).getByRole("button", { name: "Resolve" }));

    const reopened = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    await waitFor(() => {
      expect(within(reopened).getByLabelText("Caption for sunset.png")).toHaveValue(
        "Golden hour over the river",
      );
    });
    expect(
      within(reopened).queryByRole("button", { name: "Resolve caption issue for sunset.png" }),
    ).not.toBeInTheDocument();
  });

  it("returns to the gallery item modal when the resolver is dismissed unresolved", async () => {
    const user = userEvent.setup();
    installIssueBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "View sunset.png" }));

    const modal = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    await user.click(
      within(modal).getByRole("button", { name: "Resolve caption issue for sunset.png" }),
    );

    const resolver = await screen.findByRole("dialog", {
      name: "Resolve caption issue for sunset.png",
    });
    await user.click(within(resolver).getByRole("button", { name: "Close" }));

    const reopened = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    expect(
      within(reopened).getByRole("button", { name: "Resolve caption issue for sunset.png" }),
    ).toBeInTheDocument();
  });

  it("closes to the gallery when the issue queue was started from the automation panel", async () => {
    const user = userEvent.setup();
    installIssueBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "Resolve 1 caption issue" }));

    const resolver = await screen.findByRole("dialog", {
      name: "Resolve caption issue for sunset.png",
    });
    await user.click(within(resolver).getByRole("button", { name: "Resolve" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
  });
});
