import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as captionsApi from "@/features/gallery/api/captions";
import { SECONDARY_JOB_GROUPS, SECONDARY_JOB_TYPES } from "@/features/jobs/lib/jobMeta";
import { installMockBackend } from "@/test/mockBackend";
import { renderApp } from "@/test/renderApp";

afterEach(() => vi.restoreAllMocks());

async function openInspector(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "View sunset.png" }));
  return screen.findByRole("complementary", { name: "Viewing sunset.png" });
}

describe("App workspace", () => {
  it("keeps the inspected file and caption when opening folder instructions", async () => {
    const user = userEvent.setup();
    installMockBackend();
    renderApp();
    const inspector = await openInspector(user);
    const caption = within(inspector).getByLabelText("Caption for sunset.png");
    await user.clear(caption);
    await user.type(caption, "A lake at sunset");
    await user.click(screen.getByRole("button", { name: "Edit instructions" }));
    const instructions = await screen.findByRole("dialog", { name: "Folder instructions" });
    expect(inspector).toBeInTheDocument();
    await user.click(within(instructions).getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("complementary", { name: "Viewing sunset.png" })).toBe(
      inspector,
    );
    expect(caption).toHaveValue("A lake at sunset");
  });

  it("pages the docked inspector from the gallery and its header", async () => {
    const user = userEvent.setup();
    installMockBackend();
    renderApp();
    const inspector = await openInspector(user);
    const counter = inspector.querySelector(".gallery-item-modal__counter")!;
    const start = counter.textContent;
    expect(start).toMatch(/^\d+ \/ 3$/);
    // Focus stays on the clicked card, outside the inspector.
    expect(inspector).not.toContainElement(document.activeElement as HTMLElement);
    await user.keyboard("{ArrowRight}");
    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: "Viewing sunset.png" }),
      ).not.toBeInTheDocument(),
    );
    const moved = screen.getByRole("complementary", { name: /^Viewing / });
    await user.click(within(moved).getByRole("button", { name: "Previous item" }));
    const back = await screen.findByRole("complementary", { name: "Viewing sunset.png" });
    expect(back.querySelector(".gallery-item-modal__counter")).toHaveTextContent(start!);
  });

  it("remembers the media presentation when reopening files and remounting the app", async () => {
    const user = userEvent.setup();
    installMockBackend();
    const app = renderApp();
    const inspector = await openInspector(user);
    await user.click(within(inspector).getByRole("button", { name: "Expand media view" }));
    const focus = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    await user.click(within(focus).getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "View beach.jpg" }));
    expect(await screen.findByRole("dialog", { name: "Viewing beach.jpg" })).toBeInTheDocument();
    app.unmount();
    renderApp();
    await user.click(await screen.findByRole("button", { name: "View sunset.png" }));
    const restored = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    await user.click(within(restored).getByRole("button", { name: "Return to caption inspector" }));
    const inline = await screen.findByRole("complementary", { name: "Viewing sunset.png" });
    await user.click(within(inline).getByRole("button", { name: "Close" }));
    expect(await openInspector(user)).toBeInTheDocument();
  });

  it("closes the focused inspector with Escape while preserving bulk selection", async () => {
    const user = userEvent.setup();
    installMockBackend();
    renderApp();
    const inspector = await openInspector(user);
    await user.keyboard("{Control>}");
    await user.click(screen.getByRole("button", { name: "View waves.mp4" }));
    await user.keyboard("{/Control}");
    await user.click(within(inspector).getByLabelText("Caption for sunset.png"));
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: "Viewing sunset.png" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Deselect waves.mp4" })).toBeInTheDocument();
  });
  it("keeps caption drafts when expanding and returning to the inspector", async () => {
    const user = userEvent.setup();
    installMockBackend();
    renderApp();
    const inspector = await openInspector(user);
    const caption = within(inspector).getByLabelText("Caption for sunset.png");
    await user.clear(caption);
    await user.type(caption, "A lake at sunset");
    await user.click(within(inspector).getByRole("button", { name: "Expand media view" }));
    const focus = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    expect(within(focus).getByLabelText("Caption for sunset.png")).toHaveValue("A lake at sunset");
    await user.click(within(focus).getByRole("button", { name: "Return to caption inspector" }));
    expect(
      within(
        await screen.findByRole("complementary", { name: "Viewing sunset.png" }),
      ).getByLabelText("Caption for sunset.png"),
    ).toHaveValue("A lake at sunset");
    expect(document.querySelector("main")).not.toHaveAttribute("inert");
    expect(document.body).not.toHaveClass("gallery-item-modal-open");
  });

  it("waits for caption saving before inspecting another file", async () => {
    const user = userEvent.setup();
    installMockBackend();
    renderApp();
    const inspector = await openInspector(user);
    const original = captionsApi.saveCaption;
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const save = vi.spyOn(captionsApi, "saveCaption").mockImplementation(async (path, text) => {
      await pending;
      return original(path, text);
    });
    const caption = within(inspector).getByLabelText("Caption for sunset.png");
    await user.clear(caption);
    await user.type(caption, "A lakeside sunset");
    await user.click(screen.getByRole("button", { name: "View beach.jpg" }));
    expect(save).toHaveBeenCalled();
    expect(inspector).toBeInTheDocument();
    finish();
    await screen.findByRole("complementary", { name: "Viewing beach.jpg" });
    expect(save.mock.calls.at(-1)?.[1]).toBe("A lakeside sunset");
  });

  it.each(["Retry and continue", "Discard and continue"])(
    "retains a failed draft until %s before navigating folders",
    async (choice) => {
      const user = userEvent.setup();
      installMockBackend();
      renderApp();
      const inspector = await openInspector(user);
      const save = vi
        .spyOn(captionsApi, "saveCaption")
        .mockRejectedValue(new Error("Write failed"));
      const caption = within(inspector).getByLabelText("Caption for sunset.png");
      await user.clear(caption);
      await user.type(caption, "Unsaved lake caption");
      await user.click(screen.getByRole("button", { name: "Vacation" }));
      await screen.findByText(/The caption could not be saved/);
      expect(caption).toHaveValue("Unsaved lake caption");
      expect(screen.queryByRole("button", { name: "View lake.png" })).not.toBeInTheDocument();
      save.mockRestore();
      await user.click(screen.getByRole("button", { name: choice }));
      await screen.findByRole("button", { name: "View lake.png" });
    },
  );

  it("lists the grouped tools and restores trigger focus on close", async () => {
    const user = userEvent.setup();
    installMockBackend();
    renderApp();
    const trigger = await screen.findByRole("button", { name: "Tools" });
    await user.click(trigger);
    const drawer = await screen.findByRole("menu", { name: "Tools" });
    // Auto-caption has its own button, so Tools lists only the secondary jobs.
    expect(drawer.querySelectorAll(".workspace-tools__item")).toHaveLength(
      SECONDARY_JOB_TYPES.length,
    );
    expect(within(drawer).getAllByRole("group")).toHaveLength(SECONDARY_JOB_GROUPS.length);
    expect(within(drawer).queryByRole("searchbox")).not.toBeInTheDocument();
    expect(
      within(drawer).queryByRole("menuitem", { name: "Folder instructions" }),
    ).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("uses visible results for bulk tools and disables empty scopes in the command palette", async () => {
    const user = userEvent.setup();
    installMockBackend();
    renderApp();
    const search = await screen.findByRole("searchbox", {
      name: "Search files and folders by name or caption",
    });
    await user.type(search, "sunset.png");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "View beach.jpg" })).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Auto-caption" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Start auto-caption?" });
    expect(dialog).toHaveTextContent("Matching 1 file in Photos");
    await user.keyboard("{Escape}");
    await user.clear(search);
    await user.type(search, "no matching media");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Auto-caption" })).toBeDisabled(),
    );
    expect(screen.queryByRole("button", { name: /Commands/ })).not.toBeInTheDocument();
    await user.keyboard("{Control>}p{/Control}");
    const palette = await screen.findByRole("dialog", { name: "Quick actions" });
    await user.type(within(palette).getByRole("combobox"), "Auto-caption");
    expect(within(palette).getByRole("option", { name: /Auto-caption/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});
