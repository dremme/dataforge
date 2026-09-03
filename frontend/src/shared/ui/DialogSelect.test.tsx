import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DialogSelect } from "./DialogSelect";

const OPTIONS = [
  { value: "upscale", title: "Upscale 2x" },
  { value: "fix-faces", title: "Fix faces" },
] as const;

/** jsdom has no `showPicker`, so the picker is a stub hung off the rendered select. */
function renderSelect(props: Partial<Parameters<typeof DialogSelect<string>>[0]> = {}) {
  const onChange = vi.fn();
  const { container } = render(
    <DialogSelect
      label="Workflow"
      value="upscale"
      options={OPTIONS}
      onChange={onChange}
      {...props}
    />,
  );

  const select = screen.getByRole("combobox", { name: "Workflow" }) as HTMLSelectElement;
  const showPicker = vi.fn();
  select.showPicker = showPicker;

  return {
    onChange,
    select,
    showPicker,
    wrap: container.querySelector(".dialog__select-wrap") as HTMLElement,
  };
}

describe("DialogSelect", () => {
  it("opens the dropdown when the click lands on the wrap's padding", () => {
    // The wrap's padding keeps the UA arrow off the border, and used to swallow these clicks.
    const { select, showPicker, wrap } = renderSelect();

    fireEvent.mouseDown(wrap);

    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(select).toHaveFocus();
  });

  it("leaves a click on the select itself to the browser", () => {
    const { select, showPicker } = renderSelect();

    fireEvent.mouseDown(select);

    // Opening it by hand as well would toggle the native dropdown straight back shut.
    expect(showPicker).not.toHaveBeenCalled();
  });

  it("stays shut while the dialog is busy", () => {
    const { select, showPicker, wrap } = renderSelect({ disabled: true });

    fireEvent.mouseDown(wrap);

    expect(showPicker).not.toHaveBeenCalled();
    expect(select).not.toHaveFocus();
  });

  it("reports the chosen value", async () => {
    const user = userEvent.setup();
    const { onChange, select } = renderSelect();

    await user.selectOptions(select, "fix-faces");

    expect(onChange).toHaveBeenCalledWith("fix-faces");
  });
});
