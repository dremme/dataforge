import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TRAINING_PROMPTS } from "@/features/automation/lib/training";
import { TrainLoraDialog } from "./TrainLoraDialog";

function renderDialog(onConfirm = vi.fn()) {
  render(
    <TrainLoraDialog
      folderLabel="landscapes"
      itemCount={24}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />,
  );
  return onConfirm;
}

describe("TrainLoraDialog", () => {
  it("focuses the name field and seeds the default prompts", () => {
    renderDialog();

    expect(screen.getByLabelText("LoRA name")).toHaveFocus();
    expect(screen.getAllByRole("textbox", { name: /Example prompt/ })).toHaveLength(
      DEFAULT_TRAINING_PROMPTS.length,
    );
  });

  it("submits the name, trigger word and prompts", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.type(screen.getByLabelText("LoRA name"), "sample_train_v1");
    await user.type(screen.getByLabelText("Trigger word (optional)"), "mtnstyle");
    await user.click(screen.getByRole("button", { name: "Start training" }));

    expect(onConfirm).toHaveBeenCalledWith({
      loraName: "sample_train_v1",
      triggerWord: "mtnstyle",
      prompts: DEFAULT_TRAINING_PROMPTS,
    });
  });

  it("treats the trigger word as optional", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.type(screen.getByLabelText("LoRA name"), "sample_train_v1");
    await user.click(screen.getByRole("button", { name: "Start training" }));

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ triggerWord: "" }));
  });

  it("refuses a name that could not become a folder", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.type(screen.getByLabelText("LoRA name"), "sub/name");
    await user.click(screen.getByRole("button", { name: "Start training" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("cannot contain");
  });

  it("refuses an empty name", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.click(screen.getByRole("button", { name: "Start training" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a name");
  });

  it("adds, edits and removes prompt rows", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.type(screen.getByLabelText("LoRA name"), "sample_train_v1");

    for (const row of screen.getAllByRole("button", { name: /Remove example prompt/ }).reverse()) {
      await user.click(row);
    }
    expect(screen.queryAllByRole("textbox", { name: /Example prompt/ })).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Add prompt" }));
    await user.type(
      screen.getByRole("textbox", { name: "Example prompt 1" }),
      "a wooden chair beside a window",
    );
    await user.click(screen.getByRole("button", { name: "Start training" }));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ prompts: ["a wooden chair beside a window"] }),
    );
  });

  it("refuses to start with no prompts left", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.type(screen.getByLabelText("LoRA name"), "sample_train_v1");
    for (const row of screen.getAllByRole("button", { name: /Remove example prompt/ }).reverse()) {
      await user.click(row);
    }
    await user.click(screen.getByRole("button", { name: "Start training" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("at least one example prompt");
  });
});
