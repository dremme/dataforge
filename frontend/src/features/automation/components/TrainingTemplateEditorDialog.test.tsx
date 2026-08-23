import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrainingTemplateEditorDialog } from "./TrainingTemplateEditorDialog";

const checkTrainingTemplate = vi.fn();

vi.mock("@/features/automation/api/jobs", () => ({
  checkTrainingTemplate: (...args: unknown[]) => checkTrainingTemplate(...args),
}));

const STOCK = "config:\n  process:\n    - train:\n        steps: 1000\n";

function renderEditor(overrides: { initialContent?: string } = {}) {
  const onApply = vi.fn();
  const onClose = vi.fn();
  render(
    <TrainingTemplateEditorDialog
      model="krea2_turbo"
      initialContent={overrides.initialContent ?? STOCK}
      stockContent={STOCK}
      onClose={onClose}
      onApply={onApply}
    />,
  );
  return { onApply, onClose };
}

function editor() {
  return screen.getByLabelText("Krea 2 Turbo training template");
}

describe("TrainingTemplateEditorDialog", () => {
  beforeEach(() => {
    checkTrainingTemplate.mockReset();
    checkTrainingTemplate.mockResolvedValue({ ok: true, error: null });
  });

  it("opens on the template it was given and names the model", () => {
    renderEditor();

    expect(editor()).toHaveValue(STOCK);
    expect(screen.getByRole("heading", { name: "Krea 2 Turbo template" })).toBeInTheDocument();
  });

  it("says the edit is scoped to this run and the blanks are filled later", () => {
    renderEditor();

    expect(screen.getByText(/this training run only/i)).toBeInTheDocument();
    expect(screen.getByText(/template on disk is left alone/i)).toBeInTheDocument();
  });

  /** An unedited draft must send null, or every run would pin a copy of the template. */
  it("applies null when the draft still matches the stock template", async () => {
    const user = userEvent.setup();
    const { onApply } = renderEditor();

    await user.click(screen.getByRole("button", { name: "Use for this run" }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(null));
  });

  it("applies the edited YAML once the backend accepts it", async () => {
    const user = userEvent.setup();
    const { onApply } = renderEditor();

    await user.clear(editor());
    await user.type(editor(), "steps: 250");

    await user.click(screen.getByRole("button", { name: "Use for this run" }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith("steps: 250"));
    expect(checkTrainingTemplate).toHaveBeenCalledWith("steps: 250", expect.anything());
  });

  it("shows the backend's reason and keeps the editor open on a bad draft", async () => {
    const user = userEvent.setup();
    checkTrainingTemplate.mockResolvedValue({
      ok: false,
      error: "The edited training template is not valid YAML: line 2",
    });
    const { onApply, onClose } = renderEditor();

    await user.clear(editor());
    await user.type(editor(), "steps: : :");
    await user.click(screen.getByRole("button", { name: "Use for this run" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("not valid YAML");
    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("clears the error once the draft is touched again", async () => {
    const user = userEvent.setup();
    checkTrainingTemplate.mockResolvedValue({ ok: false, error: "broken" });
    renderEditor();

    await user.click(screen.getByRole("button", { name: "Use for this run" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.type(editor(), "x");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("resets a draft back to the stock template", async () => {
    const user = userEvent.setup();
    renderEditor({ initialContent: "steps: 250" });

    const reset = screen.getByRole("button", { name: /Reset/ });
    expect(reset).toBeEnabled();

    await user.click(reset);

    expect(editor()).toHaveValue(STOCK);
    expect(reset).toBeDisabled();
  });

  it("has nothing to reset when the draft is already the stock template", () => {
    renderEditor();

    expect(screen.getByRole("button", { name: /Reset/ })).toBeDisabled();
  });

  it("reports whether the draft differs from the stock template", async () => {
    const user = userEvent.setup();
    renderEditor();

    expect(screen.getByText("Unchanged")).toBeInTheDocument();

    await user.type(editor(), "steps: 1");

    expect(screen.getByText("Edited")).toBeInTheDocument();
  });
});
