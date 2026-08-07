import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RadioTileGroup, type RadioTileOption } from "./RadioTileGroup";

const OPTIONS: ReadonlyArray<RadioTileOption<"one" | "two">> = [
  { value: "one", title: "One", description: "The first" },
  { value: "two", title: "Two" },
];

describe("RadioTileGroup", () => {
  it("reports the value the user picked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <RadioTileGroup
        value="one"
        options={OPTIONS}
        label="Count"
        name="count"
        groupLabel="Count"
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("radio", { name: /One/ })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Two" }));

    expect(onChange).toHaveBeenCalledWith("two");
  });

  it("labels the group for assistive technology", () => {
    render(
      <RadioTileGroup
        value="one"
        options={OPTIONS}
        label="Count"
        name="count"
        groupLabel="How many"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("radiogroup", { name: "How many" })).toBeInTheDocument();
  });

  it("disables every tile at once", () => {
    render(
      <RadioTileGroup
        value="one"
        options={OPTIONS}
        label="Count"
        name="count"
        groupLabel="Count"
        disabled
        onChange={vi.fn()}
      />,
    );

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toBeDisabled();
    }
  });

  it("keeps two groups in one form independent", async () => {
    const user = userEvent.setup();

    render(
      <>
        <RadioTileGroup
          value="one"
          options={OPTIONS}
          label="First"
          name="first"
          groupLabel="First"
          onChange={vi.fn()}
        />
        <RadioTileGroup
          value="two"
          options={OPTIONS}
          label="Second"
          name="second"
          groupLabel="Second"
          onChange={vi.fn()}
        />
      </>,
    );

    const first = screen.getByRole("radiogroup", { name: "First" });
    const second = screen.getByRole("radiogroup", { name: "Second" });

    await user.click(within(second).getByRole("radio", { name: "Two" }));

    // A shared radio name would have unchecked the first group's selection.
    expect(within(second).getByRole("radio", { name: "Two" })).toBeChecked();
    expect(within(first).getByRole("radio", { name: /One/ })).toBeChecked();
  });
});
