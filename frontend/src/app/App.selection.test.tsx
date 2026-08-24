import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { installMockBackend } from "@/test/mockBackend";
import { renderApp } from "@/test/renderApp";

/** The home folder, sorted name-ascending as the gallery renders it. */
const ORDER = ["beach.jpg", "sunset.png", "waves.mp4"];

async function waitForHomeFolder() {
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "View beach.jpg" })).toBeInTheDocument();
  });
}

/** A card is labelled "View x" outside selection mode, "Select"/"Deselect x" inside it. */
function card(name: string) {
  return screen.getByRole("button", { name: new RegExp(`^(View|Select|Deselect) ${name}$`) });
}

function selectedNames() {
  return ORDER.filter((name) => card(name).getAttribute("aria-pressed") === "true");
}

afterEach(() => {
  localStorage.clear();
});

describe("App: modifier-click selection", () => {
  it("enters selection mode and selects the item on Ctrl+click", async () => {
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    fireEvent.click(card("sunset.png"), { ctrlKey: true });

    // The controls swapping to Done is the tell that selection mode is on.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Exit selection mode" })).toBeInTheDocument();
    });
    expect(selectedNames()).toEqual(["sunset.png"]);
  });

  it("does not open the item it selects", async () => {
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    fireEvent.click(card("sunset.png"), { ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Exit selection mode" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("dialog", { name: /sunset\.png/ })).not.toBeInTheDocument();
  });

  it("treats Cmd+click the same, for macOS", async () => {
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    fireEvent.click(card("beach.jpg"), { metaKey: true });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Exit selection mode" })).toBeInTheDocument();
    });
    expect(selectedNames()).toEqual(["beach.jpg"]);
  });

  it("deselects on a second Ctrl+click, staying in selection mode", async () => {
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    fireEvent.click(card("sunset.png"), { ctrlKey: true });
    await waitFor(() => {
      expect(selectedNames()).toEqual(["sunset.png"]);
    });

    fireEvent.click(card("sunset.png"), { ctrlKey: true });

    await waitFor(() => {
      expect(selectedNames()).toEqual([]);
    });
    expect(screen.getByRole("button", { name: "Exit selection mode" })).toBeInTheDocument();
  });

  it("selects everything between the last-clicked item and a Shift+click", async () => {
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    fireEvent.click(card("beach.jpg"), { ctrlKey: true });
    await waitFor(() => {
      expect(selectedNames()).toEqual(["beach.jpg"]);
    });

    fireEvent.click(card("waves.mp4"), { shiftKey: true });

    await waitFor(() => {
      expect(selectedNames()).toEqual(ORDER);
    });
  });

  it("extends upwards from the anchor just the same", async () => {
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    fireEvent.click(card("waves.mp4"), { ctrlKey: true });
    await waitFor(() => {
      expect(selectedNames()).toEqual(["waves.mp4"]);
    });

    fireEvent.click(card("beach.jpg"), { shiftKey: true });

    await waitFor(() => {
      expect(selectedNames()).toEqual(ORDER);
    });
  });

  // The anchor stays put, so a second Shift+click re-measures the same range
  // rather than walking it along from wherever the last one landed.
  it("re-measures from the same anchor on a second Shift+click", async () => {
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    fireEvent.click(card("beach.jpg"), { ctrlKey: true });
    await waitFor(() => {
      expect(selectedNames()).toEqual(["beach.jpg"]);
    });

    fireEvent.click(card("waves.mp4"), { shiftKey: true });
    await waitFor(() => {
      expect(selectedNames()).toEqual(ORDER);
    });

    fireEvent.click(card("sunset.png"), { shiftKey: true });

    // Still anchored on beach.jpg, so this adds nothing new rather than
    // starting a fresh range at waves.mp4.
    await waitFor(() => {
      expect(selectedNames()).toEqual(ORDER);
    });
  });

  it("enters selection mode straight from a Shift+click, selecting just that item", async () => {
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    fireEvent.click(card("sunset.png"), { shiftKey: true });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Exit selection mode" })).toBeInTheDocument();
    });
    expect(selectedNames()).toEqual(["sunset.png"]);
  });

  it("still opens the item on a plain click", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    await user.click(card("sunset.png"));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Exit selection mode" })).not.toBeInTheDocument();
  });
});

describe("App: select-all shortcut", () => {
  it("enters selection mode and selects every visible file on Ctrl+A", async () => {
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Exit selection mode" })).toBeInTheDocument();
    });
    expect(selectedNames()).toEqual(ORDER);
    expect(screen.getByLabelText("3 of 3")).toHaveClass("gallery-section__count");
  });

  it("treats Cmd+A the same, for macOS", async () => {
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    fireEvent.keyDown(window, { key: "a", metaKey: true });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Exit selection mode" })).toBeInTheDocument();
    });
    expect(selectedNames()).toEqual(ORDER);
  });

  it("fills in the rest of the view when some items are already selected", async () => {
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    fireEvent.click(card("sunset.png"), { ctrlKey: true });
    await waitFor(() => {
      expect(selectedNames()).toEqual(["sunset.png"]);
    });

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });

    await waitFor(() => {
      expect(selectedNames()).toEqual(ORDER);
    });
  });

  it("leaves Ctrl+A to the search box instead of selecting the gallery", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    const search = screen.getByRole("searchbox", {
      name: "Search files and folders by name or caption",
    });
    await user.click(search);
    await user.keyboard("{Control>}a{/Control}");

    expect(screen.queryByRole("button", { name: "Exit selection mode" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select" })).toBeInTheDocument();
  });

  it("does not select gallery items while an item modal is open", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    await user.click(card("sunset.png"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });

    expect(screen.queryByRole("button", { name: "Exit selection mode" })).not.toBeInTheDocument();
  });
});

describe("App: selection actions keep the mode", () => {
  it("stays in selection mode after deleting selected files", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    fireEvent.click(card("sunset.png"), { ctrlKey: true });
    await waitFor(() => {
      expect(selectedNames()).toEqual(["sunset.png"]);
    });

    await user.click(screen.getByRole("button", { name: "Delete selected files" }));
    const confirmDialog = await screen.findByRole("alertdialog", { name: "Delete file?" });
    await user.click(within(confirmDialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Exit selection mode" })).toBeInTheDocument();
  });
});
