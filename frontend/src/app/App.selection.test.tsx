import { fireEvent, screen, waitFor } from "@testing-library/react";
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
