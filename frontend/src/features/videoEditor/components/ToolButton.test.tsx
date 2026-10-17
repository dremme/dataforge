import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { iconUndo2 } from "@/shared/icons";
import { SHORTCUTS } from "@/shared/lib/shortcuts";
import { ToolButton } from "./ToolButton";

describe("ToolButton", () => {
  it("names its key in key caps, as the rest of the app does", async () => {
    render(
      <ToolButton
        icon={iconUndo2}
        label="Undo"
        shortcut={SHORTCUTS.editorUndo}
        onClick={vi.fn<() => void>()}
      />,
    );
    const button = screen.getByRole("button", { name: "Undo" });
    expect(button).toHaveAttribute("aria-keyshortcuts", "Control+Z Meta+Z");

    fireEvent.focus(button);
    const tooltip = await screen.findByRole("tooltip");

    expect(tooltip).toHaveTextContent(/^Undo/);
    expect(tooltip).not.toHaveTextContent("(");
    const caps = within(tooltip)
      .getAllByText(/./, { selector: "kbd" })
      .map((cap) => cap.textContent);
    expect(caps).toEqual(["Ctrl", "Z"]);
  });
});
