import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnchoredLayer } from "@/shared/ui/AnchoredLayer";
import { usePopupMenu } from "./usePopupMenu";

function MenuFixture() {
  const { open, close, menuId, rootRef, panelRef, triggerProps } = usePopupMenu();

  return (
    <div>
      <div ref={rootRef} data-testid="root">
        <button type="button" aria-label="Open menu" {...triggerProps}>
          Trigger
        </button>
      </div>
      <AnchoredLayer
        anchorRef={rootRef}
        floatingRef={panelRef}
        open={open}
        id={menuId}
        role="menu"
        label="Options"
      >
        <button type="button" role="menuitem" onClick={close}>
          Pick
        </button>
      </AnchoredLayer>
      <button type="button">Elsewhere</button>
    </div>
  );
}

const trigger = () => screen.getByRole("button", { name: "Open menu" });

describe("usePopupMenu", () => {
  it("toggles the panel from the trigger", () => {
    render(<MenuFixture />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(trigger());
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.click(trigger());
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  // The three attributes are a set; a menu missing one is broken only for
  // screen readers, so assert the whole contract rather than any one of them.
  it("points the trigger at the panel only while it is mounted", () => {
    render(<MenuFixture />);
    expect(trigger()).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(trigger()).not.toHaveAttribute("aria-controls");

    fireEvent.click(trigger());

    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(trigger().getAttribute("aria-controls")).toBe(screen.getByRole("menu").id);
  });

  it("closes on Escape", () => {
    render(<MenuFixture />);
    fireEvent.click(trigger());

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on a press outside the root", () => {
    render(<MenuFixture />);
    fireEvent.click(trigger());

    fireEvent.mouseDown(screen.getByRole("button", { name: "Elsewhere" }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  // Portalled panel is outside the dismissal root; mousedown there must not close before click.
  it("stays open on a press inside the portalled panel", () => {
    render(<MenuFixture />);
    fireEvent.click(trigger());

    const menu = screen.getByRole("menu");
    expect(screen.getByTestId("root").contains(menu)).toBe(false);

    fireEvent.mouseDown(screen.getByRole("menuitem", { name: "Pick" }));

    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("closes when an item calls close", () => {
    render(<MenuFixture />);
    fireEvent.click(trigger());

    fireEvent.click(screen.getByRole("menuitem", { name: "Pick" }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  // Portalled panel is not next to its trigger in tab order; focus must hand off.
  it("moves focus into the panel and hands it back on close", () => {
    render(<MenuFixture />);

    fireEvent.click(trigger());
    expect(screen.getByRole("menu")).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(trigger()).toHaveFocus();
  });

  it("leaves focus alone when the user has already moved it elsewhere", () => {
    render(<MenuFixture />);
    fireEvent.click(trigger());

    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
    elsewhere.focus();
    fireEvent.mouseDown(elsewhere);

    expect(elsewhere).toHaveFocus();
  });
});
