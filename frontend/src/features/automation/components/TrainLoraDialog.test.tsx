import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TRAINING_PROMPTS } from "@/features/automation/lib/training";
import { TrainLoraDialog } from "./TrainLoraDialog";
import {
  emptyAutomationSettings,
  type JobSettingsByType,
} from "@/features/automation/preferences/automationPreferences";

const DEFAULTS: JobSettingsByType["train_lora"] =
  emptyAutomationSettings("C:/datasets/photos").train_lora;

const fetchTrainingTemplate = vi.fn();
const checkTrainingTemplate = vi.fn();

vi.mock("@/features/automation/api/jobs", () => ({
  fetchTrainingTemplate: (...args: unknown[]) => fetchTrainingTemplate(...args),
  checkTrainingTemplate: (...args: unknown[]) => checkTrainingTemplate(...args),
}));

const KREA_TEMPLATE = "model:\n  arch: krea2:turbo\n";
const H3_TEMPLATE = "model:\n  arch: minimax_h3\n";

function renderDialog(
  onConfirm = vi.fn(),
  overrides: Partial<JobSettingsByType["train_lora"]> = {},
) {
  render(
    <TrainLoraDialog
      scope={{ itemCount: 24, folderLabel: "landscapes", fromSelection: false }}
      initialSettings={{ ...DEFAULTS, ...overrides }}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />,
  );
  return onConfirm;
}

describe("TrainLoraDialog", () => {
  beforeEach(() => {
    fetchTrainingTemplate.mockReset();
    checkTrainingTemplate.mockReset();
    fetchTrainingTemplate.mockImplementation(async (model: string) =>
      model === "h3_fl2va" ? H3_TEMPLATE : KREA_TEMPLATE,
    );
    checkTrainingTemplate.mockResolvedValue({ ok: true, error: null });
  });

  it("focuses the name field and seeds the default prompts", () => {
    renderDialog();

    expect(screen.getByLabelText("LoRA name")).toHaveFocus();
    expect(screen.getAllByRole("textbox", { name: /Sample prompt/ })).toHaveLength(
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
      model: "krea2_turbo",
      template: null,
    });
  });

  it("defaults the model dropdown to Krea 2 Turbo and names it in the description", () => {
    renderDialog();

    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("krea2_turbo");
    expect(screen.getByText(/Trains a Krea 2 Turbo LoRA on them/)).toBeInTheDocument();
  });

  it("submits the picked model and renames it in the description", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.selectOptions(screen.getByRole("combobox", { name: "Model" }), "h3_fl2va");
    expect(screen.getByText(/Trains a MiniMax H3 LoRA on them/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("LoRA name"), "sample_train_v1");
    await user.click(screen.getByRole("button", { name: "Start training" }));

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ model: "h3_fl2va" }));
  });

  it("keeps typed prompts when the model changes", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    const [firstPrompt] = screen.getAllByRole("textbox", { name: /Sample prompt/ });
    await user.clear(firstPrompt);
    await user.type(firstPrompt, "a kite lifting off a beach");
    await user.selectOptions(screen.getByRole("combobox", { name: "Model" }), "h3_fl2va");

    await user.type(screen.getByLabelText("LoRA name"), "sample_train_v1");
    await user.click(screen.getByRole("button", { name: "Start training" }));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        prompts: ["a kite lifting off a beach", ...DEFAULT_TRAINING_PROMPTS.slice(1)],
      }),
    );
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

    for (const row of screen.getAllByRole("button", { name: /Remove Sample prompt/ }).reverse()) {
      await user.click(row);
    }
    expect(screen.queryAllByRole("textbox", { name: /Sample prompt/ })).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Add prompt" }));
    await user.type(
      screen.getByRole("textbox", { name: "Sample prompt 1" }),
      "a wooden chair beside a window",
    );
    await user.click(screen.getByRole("button", { name: "Start training" }));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ prompts: ["a wooden chair beside a window"] }),
    );
  });

  it("opens the template editor on the chosen model's template", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.selectOptions(screen.getByRole("combobox", { name: "Model" }), "h3_fl2va");
    await user.click(screen.getByRole("button", { name: /Edit template/ }));

    expect(await screen.findByRole("heading", { name: "MiniMax H3 template" })).toBeInTheDocument();
    expect(fetchTrainingTemplate).toHaveBeenCalledWith("h3_fl2va");
    expect(screen.getByLabelText("MiniMax H3 training template")).toHaveValue(H3_TEMPLATE);
  });

  it("sends the edited template with the job", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.click(screen.getByRole("button", { name: /Edit template/ }));
    const editor = await screen.findByLabelText("Krea 2 Turbo training template");
    await user.clear(editor);
    await user.type(editor, "steps: 250");
    await user.click(screen.getByRole("button", { name: "Use for this run" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /template/ })).toBeNull());
    await user.type(screen.getByLabelText("LoRA name"), "sample_train_v1");
    await user.click(screen.getByRole("button", { name: "Start training" }));

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ template: "steps: 250" }));
  });

  /** Each model keeps its own draft, so switching models cannot silently discard an edit. */
  it("keeps a separate template draft per model", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.click(screen.getByRole("button", { name: /Edit template/ }));
    const kreaEditor = await screen.findByLabelText("Krea 2 Turbo training template");
    await user.clear(kreaEditor);
    await user.type(kreaEditor, "steps: 250");
    await user.click(screen.getByRole("button", { name: "Use for this run" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /template/ })).toBeNull());

    // H3 was never edited, so it still runs its shipped template.
    await user.selectOptions(screen.getByRole("combobox", { name: "Model" }), "h3_fl2va");
    await user.type(screen.getByLabelText("LoRA name"), "sample_train_v1");
    await user.click(screen.getByRole("button", { name: "Start training" }));
    expect(onConfirm).toHaveBeenLastCalledWith(expect.objectContaining({ template: null }));

    // Switching back finds the Krea draft intact.
    await user.selectOptions(screen.getByRole("combobox", { name: "Model" }), "krea2_turbo");
    await user.click(screen.getByRole("button", { name: "Start training" }));
    expect(onConfirm).toHaveBeenLastCalledWith(expect.objectContaining({ template: "steps: 250" }));
  });

  it("reports a template that could not be fetched", async () => {
    const user = userEvent.setup();
    fetchTrainingTemplate.mockRejectedValue(new Error("AI-Toolkit is unreachable"));
    renderDialog();

    await user.click(screen.getByRole("button", { name: /Edit template/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("unreachable");
    expect(screen.queryByRole("heading", { name: /template$/ })).toBeNull();
  });

  it("refuses to start with no prompts left", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.type(screen.getByLabelText("LoRA name"), "sample_train_v1");
    for (const row of screen.getAllByRole("button", { name: /Remove Sample prompt/ }).reverse()) {
      await user.click(row);
    }
    await user.click(screen.getByRole("button", { name: "Start training" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("at least one example prompt");
  });
});
