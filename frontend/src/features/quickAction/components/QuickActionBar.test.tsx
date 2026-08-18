import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetScrollLockManagerForTests } from "@/shared/hooks/scrollLockManager";
import { iconFolder } from "@/shared/icons";
import { readRecentActionIds } from "../lib/quickActionHistory";
import type { QuickActionItem } from "../types";
import { QuickActionBar } from "./QuickActionBar";

function makeItem(
  id: string,
  label: string,
  overrides: Partial<QuickActionItem> = {},
): QuickActionItem {
  return {
    id,
    section: "commands",
    label,
    icon: iconFolder,
    run: vi.fn(),
    ...overrides,
  };
}

function renderBar(overrides: Partial<Parameters<typeof QuickActionBar>[0]> = {}) {
  const onClose = vi.fn();
  const items = overrides.items ?? [
    makeItem("cmd:alpha", "Alpha"),
    makeItem("cmd:beta", "Beta"),
    makeItem("cmd:gamma", "Gamma"),
  ];

  render(
    <QuickActionBar
      items={items}
      recentItems={overrides.recentItems ?? items}
      onClose={onClose}
      {...overrides}
    />,
  );

  return { onClose, items };
}

function activeOptionName(): string | null {
  const input = screen.getByRole("combobox");
  const id = input.getAttribute("aria-activedescendant");
  return id ? (document.getElementById(id)?.textContent ?? null) : null;
}

afterEach(() => {
  resetScrollLockManagerForTests();
  localStorage.clear();
});

describe("QuickActionBar", () => {
  it("focuses the search field and highlights the first row on open", () => {
    renderBar();

    expect(screen.getByRole("combobox")).toHaveFocus();
    expect(activeOptionName()).toBe("Alpha");
  });

  it("shows the recent rows under a Recent heading before anything is typed", () => {
    renderBar({
      recentItems: [makeItem("cmd:beta", "Beta")],
    });

    expect(screen.getByRole("group", { name: "Recent" })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("moves the highlight with the arrow keys and wraps at both ends", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.keyboard("{ArrowDown}");
    expect(activeOptionName()).toBe("Beta");

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(activeOptionName()).toBe("Alpha");

    await user.keyboard("{ArrowUp}");
    expect(activeOptionName()).toBe("Gamma");
  });

  it("jumps to the ends with Home and End", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.keyboard("{End}");
    expect(activeOptionName()).toBe("Gamma");

    await user.keyboard("{Home}");
    expect(activeOptionName()).toBe("Alpha");
  });

  it("skips disabled rows when navigating", async () => {
    const user = userEvent.setup();
    renderBar({
      items: [
        makeItem("cmd:alpha", "Alpha"),
        makeItem("cmd:beta", "Beta", { disabled: true }),
        makeItem("cmd:gamma", "Gamma"),
      ],
    });

    await user.keyboard("{ArrowDown}");
    expect(activeOptionName()).toBe("Gamma");
  });

  it("runs the highlighted row on Enter, closing before the action fires", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    const beta = makeItem("cmd:beta", "Beta", { run: () => order.push("run") });
    const onClose = vi.fn(() => order.push("close"));

    render(<QuickActionBar items={[beta]} recentItems={[beta]} onClose={onClose} />);

    await user.keyboard("{Enter}");

    expect(order).toEqual(["close", "run"]);
  });

  it("records the run action so it leads the recent list next time", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.keyboard("{ArrowDown}{Enter}");

    expect(readRecentActionIds()).toEqual(["cmd:beta"]);
  });

  it("records nothing and stays open for a disabled row", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    const item = makeItem("cmd:alpha", "Alpha", { disabled: true, run });
    const onClose = vi.fn();

    render(<QuickActionBar items={[item]} recentItems={[item]} onClose={onClose} />);
    await user.keyboard("{Enter}");

    expect(run).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(readRecentActionIds()).toEqual([]);
  });

  it("filters as the user types and shows the matching section heading", async () => {
    const user = userEvent.setup();
    renderBar({
      items: [
        makeItem("folder:C:\\Shots", "Shots", { section: "subfolders" }),
        makeItem("cmd:alpha", "Alpha"),
      ],
    });

    await user.type(screen.getByRole("combobox"), "shot");

    expect(screen.getByRole("group", { name: "Subfolders" })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("resets the highlight to the first result when the query changes", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.keyboard("{End}");
    expect(activeOptionName()).toBe("Gamma");

    await user.type(screen.getByRole("combobox"), "a");
    expect(activeOptionName()).toBe("Alpha");
  });

  it("reports no matches rather than an empty panel", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.type(screen.getByRole("combobox"), "zzzz");

    expect(screen.getByText("No matches")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByRole("combobox")).not.toHaveAttribute("aria-activedescendant");
  });

  it("runs a row on click", async () => {
    const user = userEvent.setup();
    const { items, onClose } = renderBar();

    await user.click(screen.getByText("Gamma"));

    expect(items[2].run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("holds a scroll lock while it is open", () => {
    renderBar();
    expect(document.documentElement).toHaveClass("quick-action-open");
  });

  it("lists a folder once when it is both a subfolder and a recent, and keeps arrowing", async () => {
    const user = userEvent.setup();
    // The palette resolves the active row by id, so a repeated id used to pin the
    // highlight to the first copy and make the arrow keys look stuck.
    const shared = "folder:C:\\Shots";
    renderBar({
      recentItems: [
        makeItem(shared, "Shots", { section: "subfolders" }),
        makeItem(shared, "Shots", { section: "recentFolders" }),
        makeItem("cmd:alpha", "Alpha"),
      ],
    });

    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(activeOptionName()).toBe("Shots");

    await user.keyboard("{ArrowDown}");
    expect(activeOptionName()).toBe("Alpha");

    await user.keyboard("{ArrowDown}");
    expect(activeOptionName()).toBe("Shots");
  });

  it("keeps the highlight on the keyboard's row while the pointer rests elsewhere", async () => {
    const user = userEvent.setup();
    renderBar();

    // A stationary pointer replays mousemove at unchanged coordinates whenever
    // the element under it changes, which must not steal the selection.
    const gamma = screen.getByText("Gamma").closest('[role="option"]')!;
    fireEvent.mouseMove(gamma, { clientX: 40, clientY: 80 });
    expect(activeOptionName()).toBe("Gamma");

    await user.keyboard("{ArrowDown}");
    expect(activeOptionName()).toBe("Alpha");

    fireEvent.mouseMove(gamma, { clientX: 40, clientY: 80 });
    expect(activeOptionName()).toBe("Alpha");

    // A genuine move does claim it.
    fireEvent.mouseMove(gamma, { clientX: 41, clientY: 80 });
    expect(activeOptionName()).toBe("Gamma");
  });

  it("marks exactly one row aria-selected", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.keyboard("{ArrowDown}");

    const selected = screen
      .getAllByRole("option")
      .filter((row) => row.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent("Beta");
  });

  it("ignores a hover on a disabled row", () => {
    renderBar({
      items: [makeItem("cmd:alpha", "Alpha"), makeItem("cmd:beta", "Beta", { disabled: true })],
      recentItems: [
        makeItem("cmd:alpha", "Alpha"),
        makeItem("cmd:beta", "Beta", { disabled: true }),
      ],
    });

    fireEvent.mouseMove(screen.getByText("Beta").closest('[role="option"]')!, {
      clientX: 10,
      clientY: 10,
    });

    expect(activeOptionName()).toBe("Alpha");
  });
});
