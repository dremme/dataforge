import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GalleryDisplayMenu } from "./GalleryDisplayMenu";

describe("GalleryDisplayMenu", () => {
  it("marks the active mode and reports a new choice", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

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

  it("closes on Escape", async () => {
    const user = userEvent.setup();

    render(<GalleryDisplayMenu value="small" onChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Display mode" }));
    expect(screen.getByRole("menu", { name: "Display mode" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on a click outside the menu", async () => {
    const user = userEvent.setup();

    render(
      <div>
        <GalleryDisplayMenu value="small" onChange={vi.fn()} />
        <button type="button">Elsewhere</button>
      </div>,
    );

    await user.click(screen.getByRole("button", { name: "Display mode" }));
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));

    expect(screen.queryByRole("menu")).toBeNull();
  });
});
