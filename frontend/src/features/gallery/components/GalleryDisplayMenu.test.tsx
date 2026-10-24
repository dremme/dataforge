import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GalleryDisplayMenu } from "./GalleryDisplayMenu";
import type { GalleryDisplayMode } from "@/shared/types";

describe("GalleryDisplayMenu", () => {
  it("marks the active mode and reports a new choice", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(value: GalleryDisplayMode) => void>();

    render(<GalleryDisplayMenu value="large" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Display mode" }));

    expect(screen.getByRole("menuitemradio", { name: "Large cards" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "List" })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    await user.click(screen.getByRole("menuitemradio", { name: "List" }));

    expect(onChange).toHaveBeenCalledWith("list");
    // Choosing closes the menu; leaving it open over the grid it just relaid out
    // would cover the change the user asked for.
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("switches modes with Ctrl+1, Ctrl+2 and Ctrl+3", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(value: GalleryDisplayMode) => void>();

    const { rerender } = render(<GalleryDisplayMenu value="large" onChange={onChange} />);

    await user.keyboard("{Control>}1{/Control}");
    expect(onChange).not.toHaveBeenCalled();

    await user.keyboard("{Control>}2{/Control}");
    rerender(<GalleryDisplayMenu value="small" onChange={onChange} />);
    await user.keyboard("{Control>}3{/Control}");
    rerender(<GalleryDisplayMenu value="list" onChange={onChange} />);
    await user.keyboard("{Control>}1{/Control}");

    expect(onChange.mock.calls).toEqual([["small"], ["list"], ["large"]]);
  });

  it("names each mode's shortcut on its menu item", async () => {
    const user = userEvent.setup();

    render(
      <GalleryDisplayMenu value="large" onChange={vi.fn<(value: GalleryDisplayMode) => void>()} />,
    );

    await user.click(screen.getByRole("button", { name: "Display mode" }));

    expect(screen.getByRole("menuitemradio", { name: "Small cards" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Control+2 Meta+2",
    );
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();

    render(
      <GalleryDisplayMenu value="small" onChange={vi.fn<(value: GalleryDisplayMode) => void>()} />,
    );

    await user.click(screen.getByRole("button", { name: "Display mode" }));
    expect(screen.getByRole("menu", { name: "Display mode" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on a click outside the menu", async () => {
    const user = userEvent.setup();

    render(
      <div>
        <GalleryDisplayMenu value="small" onChange={vi.fn<(value: GalleryDisplayMode) => void>()} />
        <button type="button">Elsewhere</button>
      </div>,
    );

    await user.click(screen.getByRole("button", { name: "Display mode" }));
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));

    expect(screen.queryByRole("menu")).toBeNull();
  });
});
