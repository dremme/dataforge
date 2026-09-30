import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_PATH, HOME_PATH, VACATION_PATH } from "@/test/fixtures";
import { stubDialogClock } from "@/test/dialogClock";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
import { TransferMediaDialog } from "./TransferMediaDialog";

function renderDialog() {
  const onSelectDestination = vi.fn();
  renderWithProviders(
    <TransferMediaDialog
      mode="move"
      currentFolder={HOME_PATH}
      selectedCount={1}
      onClose={vi.fn()}
      onSelectDestination={onSelectDestination}
    />,
  );
  return { onSelectDestination };
}

async function openTree() {
  const tree = await screen.findByRole("tree", { name: "Folder tree" });
  await within(tree).findByRole("treeitem", { name: "Vacation" });
  return tree;
}

function treeItem(tree: HTMLElement, name: string) {
  return within(tree).getByRole("treeitem", { name });
}

async function focusTreeItem(tree: HTMLElement, name: string) {
  const item = treeItem(tree, name);
  act(() => item.focus());
  return item;
}

describe("TransferMediaDialog", () => {
  beforeEach(() => {
    installMockBackend();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("gives the tree a single tab stop, on the current folder", async () => {
    renderDialog();
    const tree = await openTree();

    const stops = within(tree)
      .getAllByRole("treeitem")
      .filter((item) => item.tabIndex === 0);

    expect(stops).toEqual([treeItem(tree, "Home")]);
    expect(within(tree).getByRole("button", { name: "Vacation" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("states each folder's depth", async () => {
    renderDialog();
    const tree = await openTree();

    expect(treeItem(tree, "Vacation")).toHaveAttribute("aria-level", "2");
    expect(treeItem(tree, "C:\\")).toHaveAttribute("aria-level", "1");
  });

  it("moves down the tree with the arrow keys and selects as it goes", async () => {
    const user = userEvent.setup();
    renderDialog();
    const tree = await openTree();
    await focusTreeItem(tree, "Home");

    await user.keyboard("{ArrowDown}");
    expect(treeItem(tree, "Empty")).toHaveFocus();
    expect(treeItem(tree, "Empty")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(EMPTY_PATH)).toBeInTheDocument();

    await user.keyboard("{ArrowDown}");
    expect(treeItem(tree, "Vacation")).toHaveFocus();
    expect(screen.getByText(VACATION_PATH)).toBeInTheDocument();

    await user.keyboard("{ArrowUp}");
    expect(treeItem(tree, "Empty")).toHaveFocus();
  });

  it("jumps to the first and last folder with Home and End", async () => {
    const user = userEvent.setup();
    renderDialog();
    const tree = await openTree();
    await focusTreeItem(tree, "Vacation");

    await user.keyboard("{End}");
    expect(treeItem(tree, "C:\\")).toHaveFocus();

    await user.keyboard("{Home}");
    expect(treeItem(tree, "Home")).toHaveFocus();
  });

  it("goes to the parent with the left arrow, then collapses it", async () => {
    const user = userEvent.setup();
    renderDialog();
    const tree = await openTree();
    await focusTreeItem(tree, "Vacation");

    await user.keyboard("{ArrowLeft}");
    const home = treeItem(tree, "Home");
    expect(home).toHaveFocus();
    expect(home).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{ArrowLeft}");
    expect(home).toHaveAttribute("aria-expanded", "false");
    expect(within(tree).queryByRole("treeitem", { name: "Vacation" })).not.toBeInTheDocument();
  });

  it("expands with the right arrow, then steps into the first child", async () => {
    const user = userEvent.setup();
    renderDialog();
    const tree = await openTree();
    const home = await focusTreeItem(tree, "Home");

    await user.keyboard("{ArrowLeft}");
    expect(home).toHaveAttribute("aria-expanded", "false");

    await user.keyboard("{ArrowRight}");
    expect(home).toHaveAttribute("aria-expanded", "true");
    expect(home).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(treeItem(tree, "Empty")).toHaveFocus();
  });

  it("loads a folder that was never opened, and drops its expander if it has none", async () => {
    const user = userEvent.setup();
    renderDialog();
    const tree = await openTree();
    const empty = await focusTreeItem(tree, "Empty");
    expect(empty).toHaveAttribute("aria-expanded", "false");

    await user.keyboard("{ArrowRight}");

    await waitFor(() => expect(empty).not.toHaveAttribute("aria-expanded"));
    expect(empty).toHaveFocus();
  });

  it("does not confirm on Enter before a folder is picked", async () => {
    const user = userEvent.setup();
    const clock = stubDialogClock();
    const { onSelectDestination } = renderDialog();
    const tree = await openTree();
    await focusTreeItem(tree, "Home");
    clock.passOpenGrace();

    await user.keyboard("{Enter}");

    expect(onSelectDestination).not.toHaveBeenCalled();
  });

  it("moves to the focused folder on Enter", async () => {
    const user = userEvent.setup();
    const clock = stubDialogClock();
    const { onSelectDestination } = renderDialog();
    const tree = await openTree();
    await focusTreeItem(tree, "Home");
    clock.passOpenGrace();

    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(onSelectDestination).toHaveBeenCalledWith(VACATION_PATH);
  });
});
