import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HOME_PATH, homeFolder, mediaItem } from "@/test/fixtures";
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

function installDuplicateBackend() {
  const flagged = (name: string) =>
    mediaItem(name, HOME_PATH, { has_duplicate_file: true, duplicate_group: "g1" });
  const duplicateFolder: FolderResponse = {
    ...homeFolder,
    items: homeFolder.items.map((item) =>
      item.name === "sunset.png" || item.name === "beach.jpg"
        ? { ...item, has_duplicate_file: true }
        : item,
    ),
  };
  return installMockBackend({
    folderByPath: { undefined: duplicateFolder, [HOME_PATH]: duplicateFolder },
    duplicateGroups: [
      { group: "g0", max_distance: 0, threshold: "exact", members: [flagged("other.png")] },
      {
        group: "g1",
        max_distance: 0,
        threshold: "exact",
        members: [flagged("sunset.png"), flagged("beach.jpg")],
      },
    ],
  });
}

const STAGING_PATH = `${HOME_PATH}\\staging`;

const candidateFolder: FolderResponse = {
  ...homeFolder,
  items: homeFolder.items.map((item) =>
    item.name === "sunset.png" || item.name === "beach.jpg"
      ? { ...item, has_candidate: true, candidate_name: item.name }
      : item,
  ),
};

const stagingFolder: FolderResponse = {
  ...homeFolder,
  path: STAGING_PATH,
  parent: HOME_PATH,
  subfolders: [],
  items: [mediaItem("sunset.png", STAGING_PATH), mediaItem("beach.jpg", STAGING_PATH)],
};

function installCandidateBackend() {
  return installMockBackend({
    folderByPath: {
      undefined: candidateFolder,
      [HOME_PATH]: candidateFolder,
      [STAGING_PATH]: stagingFolder,
    },
  });
}

describe("App: gallery item dialog", () => {
  it("opens and closes the gallery item dialog", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "View sunset.png" }));

    const dialog = await screen.findByRole("complementary", { name: "Viewing sunset.png" });
    expect(within(dialog).getByRole("heading", { name: "sunset.png" })).toBeInTheDocument();

    await user.click(within(dialog).getAllByRole("button", { name: "Close" })[0]);

    await waitFor(() => {
      expect(
        screen.queryByRole("complementary", { name: "Viewing sunset.png" }),
      ).not.toBeInTheDocument();
    });
  });

  it("shows a delete confirmation when deleting from the gallery item dialog", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "View sunset.png" }));

    const dialog = await screen.findByRole("complementary", { name: "Viewing sunset.png" });
    await user.click(within(dialog).getByRole("button", { name: "Delete sunset.png" }));

    const confirmDialog = await screen.findByRole("alertdialog", { name: "Delete file?" });
    expect(confirmDialog).toBeVisible();
    expect(within(confirmDialog).getByText("sunset.png")).toBeVisible();
  });

  it("moves a file to another folder from the gallery item dialog", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "View sunset.png" }));

    const dialog = await screen.findByRole("complementary", { name: "Viewing sunset.png" });
    await user.click(
      within(dialog).getByRole("button", { name: "Move sunset.png to another folder" }),
    );

    const picker = await screen.findByRole("dialog", { name: "Move to folder" });
    await user.click(await within(picker).findByRole("button", { name: "Vacation" }));
    await user.click(within(picker).getByRole("button", { name: "Move here" }));

    await screen.findByRole("complementary", { name: "Viewing waves.mp4" });
  });

  it("renames a file from the gallery item dialog and keeps viewing it under the new name", async () => {
    const user = userEvent.setup();
    const { requestsTo } = installMockBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "View sunset.png" }));
    const dialog = await screen.findByRole("complementary", { name: "Viewing sunset.png" });
    await user.click(within(dialog).getByRole("button", { name: "Rename sunset.png" }));

    const rename = await screen.findByRole("dialog", { name: "Rename file" });
    expect(within(rename).getByText(".png")).toBeVisible();
    const input = within(rename).getByLabelText("File name");
    expect(input).toHaveValue("sunset");
    await user.clear(input);
    await user.type(input, "dusk");
    await user.click(within(rename).getByRole("button", { name: "Rename" }));

    expect(await screen.findByRole("complementary", { name: "Viewing dusk.png" })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Rename file" })).not.toBeInTheDocument();
    expect(
      requestsTo(
        `/api/media/rename?path=${encodeURIComponent(`${HOME_PATH}\\sunset.png`)}&name=dusk`,
        "POST",
      ),
    ).toHaveLength(1);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View dusk.png" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "View sunset.png" })).not.toBeInTheDocument();
  });

  it("keeps the rename dialog open with the reason when the new name is taken", async () => {
    const user = userEvent.setup();
    const taken: FolderResponse = {
      ...homeFolder,
      items: [...homeFolder.items, mediaItem("dusk.png", HOME_PATH)],
      item_count: homeFolder.items.length + 1,
    };
    installMockBackend({ folderByPath: { undefined: taken, [HOME_PATH]: taken } });
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "View sunset.png" }));
    const dialog = await screen.findByRole("complementary", { name: "Viewing sunset.png" });
    await user.click(within(dialog).getByRole("button", { name: "Rename sunset.png" }));

    const rename = await screen.findByRole("dialog", { name: "Rename file" });
    const input = within(rename).getByLabelText("File name");
    await user.clear(input);
    await user.type(input, "dusk");
    await user.click(within(rename).getByRole("button", { name: "Rename" }));

    expect(await within(rename).findByRole("alert")).toHaveTextContent(
      '"dusk.png" already exists in this folder.',
    );
    expect(screen.getByRole("complementary", { name: "Viewing sunset.png" })).toBeVisible();

    await user.click(within(rename).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Rename file" })).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Viewing sunset.png" })).toBeVisible();
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

  it("returns to the gallery item dialog after resolving that file's issue", async () => {
    const user = userEvent.setup();
    installIssueBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "View sunset.png" }));

    const dialog = await screen.findByRole("complementary", { name: "Viewing sunset.png" });
    await user.click(
      within(dialog).getByRole("button", { name: "Resolve caption issue for sunset.png" }),
    );

    const resolver = await screen.findByRole("dialog", {
      name: "Resolve caption issue for sunset.png",
    });
    const caption = within(resolver).getByLabelText("Caption for sunset.png");
    await user.clear(caption);
    await user.type(caption, "Golden hour over the river");
    await user.click(within(resolver).getByRole("button", { name: "Resolve" }));

    const reopened = await screen.findByRole("complementary", { name: "Viewing sunset.png" });
    await waitFor(() => {
      expect(within(reopened).getByLabelText("Caption for sunset.png")).toHaveValue(
        "Golden hour over the river",
      );
    });
    expect(
      within(reopened).queryByRole("button", { name: "Resolve caption issue for sunset.png" }),
    ).not.toBeInTheDocument();
  });

  it("resolves a file's own duplicate group and returns to the file it kept", async () => {
    const user = userEvent.setup();
    const backend = installDuplicateBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "View sunset.png" }));
    const dialog = await screen.findByRole("complementary", { name: "Viewing sunset.png" });
    await user.click(
      within(dialog).getByRole("button", { name: "Resolve duplicate for sunset.png" }),
    );

    // Only this file's group, not the folder's whole queue.
    const resolver = await screen.findByRole("dialog", { name: "Resolve duplicate group 1 of 1" });
    await user.click(within(resolver).getByRole("radio", { name: /sunset\.png/ }));
    await user.click(within(resolver).getByRole("button", { name: "Resolve" }));

    await waitFor(() => {
      const [[, init]] = backend.requestsTo("/api/duplicates/resolve", "POST");
      expect(JSON.parse(init?.body as string)).toEqual({
        keep: `${HOME_PATH}\\sunset.png`,
        discard: [`${HOME_PATH}\\beach.jpg`],
      });
    });
    expect(
      await screen.findByRole("complementary", { name: "Viewing sunset.png" }),
    ).toBeInTheDocument();
  });

  it("offers no duplicate button for a file without a finding", async () => {
    const user = userEvent.setup();
    installDuplicateBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "View waves.mp4" }));

    const dialog = await screen.findByRole("complementary", { name: "Viewing waves.mp4" });
    expect(within(dialog).queryByRole("button", { name: /Resolve duplicate/ })).toBeNull();
  });

  it("returns to the gallery item dialog when the resolver is dismissed unresolved", async () => {
    const user = userEvent.setup();
    installIssueBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "View sunset.png" }));

    const dialog = await screen.findByRole("complementary", { name: "Viewing sunset.png" });
    await user.click(
      within(dialog).getByRole("button", { name: "Resolve caption issue for sunset.png" }),
    );

    const resolver = await screen.findByRole("dialog", {
      name: "Resolve caption issue for sunset.png",
    });
    await user.click(within(resolver).getByRole("button", { name: "Close" }));

    const reopened = await screen.findByRole("complementary", { name: "Viewing sunset.png" });
    expect(
      within(reopened).getByRole("button", { name: "Resolve caption issue for sunset.png" }),
    ).toBeInTheDocument();
  });

  it("closes to the gallery when the issue queue was started from the Review menu", async () => {
    const user = userEvent.setup();
    installIssueBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: /^Review / }));
    await user.click(await screen.findByRole("menuitem", { name: /Caption issues/ }));

    const resolver = await screen.findByRole("dialog", {
      name: "Resolve caption issue for sunset.png",
    });
    await user.click(within(resolver).getByRole("button", { name: "Resolve" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
  });

  it("reviews only the open file's candidate, then returns to that file", async () => {
    const user = userEvent.setup();
    installCandidateBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "View sunset.png" }));

    const dialog = await screen.findByRole("complementary", { name: "Viewing sunset.png" });
    await user.click(
      within(dialog).getByRole("button", { name: "Review candidate for sunset.png" }),
    );

    const review = await screen.findByRole("dialog", { name: "Review candidate 1 of 1" });
    expect(within(review).getByRole("heading", { name: "sunset.png" })).toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", { name: "Viewing sunset.png" }),
    ).not.toBeInTheDocument();

    await user.click(within(review).getByRole("button", { name: "Close" }));

    expect(
      await screen.findByRole("complementary", { name: "Viewing sunset.png" }),
    ).toBeInTheDocument();
  });

  it("offers no candidate review for a file without one", async () => {
    const user = userEvent.setup();
    installCandidateBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "View waves.mp4" }));

    const dialog = await screen.findByRole("complementary", { name: "Viewing waves.mp4" });
    expect(
      within(dialog).queryByRole("button", { name: /^Review candidate for / }),
    ).not.toBeInTheDocument();
  });
});
