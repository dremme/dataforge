import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ToolbarSortMenu } from "./ToolbarSortMenu";

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Sort media" }));
  return screen.getByRole("menu", { name: "Sort" });
}

describe("ToolbarSortMenu", () => {
  it("lists the fields, then the current field's two orders", async () => {
    const user = userEvent.setup();
    render(<ToolbarSortMenu value="date-desc" onChange={vi.fn()} />);
    const menu = await openMenu(user);

    const fields = within(menu).getByRole("group", { name: "Sort by" });
    expect(
      within(fields)
        .getAllByRole("menuitemradio")
        .map((item) => item.textContent),
    ).toEqual(["Date modified", "Name", "Caption length", "Megapixels", "Duration"]);
    expect(within(fields).getByRole("menuitemradio", { name: "Date modified" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    const order = within(menu).getByRole("group", { name: "Order" });
    expect(
      within(order)
        .getAllByRole("menuitemradio")
        .map((item) => item.textContent),
    ).toEqual(["Newest first", "Oldest first"]);
    expect(within(order).getByRole("menuitemradio", { name: "Newest first" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("starts a newly picked field at its first order and stays open for the direction", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ToolbarSortMenu value="name-desc" onChange={onChange} />);
    const menu = await openMenu(user);

    await user.click(within(menu).getByRole("menuitemradio", { name: "Megapixels" }));

    expect(onChange).toHaveBeenCalledWith("megapixels-desc");
    expect(menu).toBeInTheDocument();
  });

  it("keeps the direction when the current field is picked again", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ToolbarSortMenu value="name-desc" onChange={onChange} />);
    const menu = await openMenu(user);

    await user.click(within(menu).getByRole("menuitemradio", { name: "Name" }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("reports a picked direction", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ToolbarSortMenu value="caption-asc" onChange={onChange} />);
    const menu = await openMenu(user);

    await user.click(within(menu).getByRole("menuitemradio", { name: "Longest first" }));

    expect(onChange).toHaveBeenCalledWith("caption-desc");
  });

  it("names the current order in its tooltip", async () => {
    const user = userEvent.setup();
    render(<ToolbarSortMenu value="megapixels-desc" onChange={vi.fn()} />);

    await user.hover(screen.getByRole("button", { name: "Sort media" }));

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Sorted by Megapixels (largest)");
  });

  it("shows the direction on the trigger, and marks only a non-default order", () => {
    const { rerender } = render(<ToolbarSortMenu value="date-desc" onChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Sort media" });
    expect(trigger.querySelector("svg")).toHaveClass("lucide-arrow-down-wide-narrow");
    expect(trigger).not.toHaveClass("toolbar__sort-menu-trigger--sorted");

    rerender(<ToolbarSortMenu value="name-asc" onChange={vi.fn()} />);
    expect(trigger.querySelector("svg")).toHaveClass("lucide-arrow-up-a-z");
    expect(trigger).toHaveClass("toolbar__sort-menu-trigger--sorted");
  });
});
