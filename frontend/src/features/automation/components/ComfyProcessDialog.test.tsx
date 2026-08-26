import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchComfyPresets } from "@/features/automation/api/jobs";
import type { JobSettingsByType } from "@/features/automation/preferences/automationPreferences";
import type { ComfyPresetsResponse } from "@/shared/types";
import { ComfyProcessDialog } from "./ComfyProcessDialog";

vi.mock("@/features/automation/api/jobs", () => ({
  fetchComfyPresets: vi.fn(),
}));

const fetchPresets = vi.mocked(fetchComfyPresets);

const SCOPE = { itemCount: 12, folderLabel: "Photos", fromSelection: false };

function settings(
  overrides: Partial<JobSettingsByType["comfy_process"]> = {},
): JobSettingsByType["comfy_process"] {
  return { preset: "", seed: null, prompt_text: "", overwrite_candidates: false, ...overrides };
}

function presets(
  names: string[],
  available = true,
  baseUrl = "http://127.0.0.1:9000",
): ComfyPresetsResponse {
  return {
    presets: names.map((name) => ({ name, modified_at: null })),
    available,
    base_url: baseUrl,
  };
}

function renderDialog(initialSettings = settings()) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();

  render(
    <ComfyProcessDialog
      scope={SCOPE}
      initialSettings={initialSettings}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );

  return { onConfirm, onCancel };
}

describe("ComfyProcessDialog", () => {
  beforeEach(() => {
    fetchPresets.mockReset().mockResolvedValue(presets(["fix-faces", "upscale-2x"]));
  });

  it("says where results go", async () => {
    renderDialog();

    // "staging" appears in the overwrite hint too, so this matches the sentence rather
    // than the word.
    expect(await screen.findByText(/writes the result as a/, { exact: false })).toBeInTheDocument();
  });

  // A select rather than a tile each: the folder of presets has no ceiling, and a
  // dozen tiles would grow the panel until it scrolled.
  it("offers every preset on disk in one control", async () => {
    renderDialog();

    const workflow = await screen.findByLabelText("Workflow");

    expect(workflow.tagName).toBe("SELECT");
    expect([...(workflow as HTMLSelectElement).options].map((option) => option.value)).toEqual([
      "fix-faces",
      "upscale-2x",
    ]);
  });

  it("starts from the preset the last run used", async () => {
    renderDialog(settings({ preset: "upscale-2x" }));

    await waitFor(() => expect(screen.getByLabelText("Workflow")).toHaveValue("upscale-2x"));
  });

  it("falls back to the first preset when the remembered one is gone", async () => {
    // Presets are files the user adds and removes, so a stored name can outlive its
    // file; a select left on a value it has no option for shows blank and confirms it.
    renderDialog(settings({ preset: "deleted-preset" }));

    await waitFor(() => expect(screen.getByLabelText("Workflow")).toHaveValue("fix-faces"));
  });

  it("explains how to add one when there are none", async () => {
    fetchPresets.mockResolvedValue(presets([]));

    renderDialog();

    expect(await screen.findByText(/Save \(API Format\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start processing" })).toBeDisabled();
  });

  it("warns but does not block when ComfyUI is not answering", async () => {
    // ComfyUI is started and stopped all day; the job only needs it by the first image.
    fetchPresets.mockResolvedValue(presets(["upscale-2x"], false));

    renderDialog();

    expect(await screen.findByRole("alert")).toHaveTextContent("not answering");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Start processing" })).toBeEnabled(),
    );
  });

  it("names the origin it probed so a wrong port is visible", async () => {
    // "Not answering" alone reads as "ComfyUI is stopped", which sends the user to the
    // wrong fix when the real cause is COMFY_BASE_URL pointing at a port nothing is on.
    fetchPresets.mockResolvedValue(presets(["upscale-2x"], false, "http://127.0.0.1:9123"));

    renderDialog();

    expect(await screen.findByRole("alert")).toHaveTextContent("http://127.0.0.1:9123");
  });

  it("spins while the presets are still loading", async () => {
    // The fetch probes ComfyUI, so an unreachable host holds this open for the whole
    // request timeout; a static line there is indistinguishable from a hung dialog.
    let resolvePresets: (value: ComfyPresetsResponse) => void = () => {};
    fetchPresets.mockReturnValue(
      new Promise<ComfyPresetsResponse>((resolve) => {
        resolvePresets = resolve;
      }),
    );

    renderDialog();

    // The dialog is portalled, so the spinner is looked for inside the status row itself
    // rather than in the render container.
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading workflow presets");
    expect(status.querySelector(".app-icon--spin")).toBeTruthy();

    resolvePresets(presets(["upscale-2x"]));

    expect(await screen.findByLabelText("Workflow")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("starts with the chosen preset and seed", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    await user.selectOptions(await screen.findByLabelText("Workflow"), "upscale-2x");
    await user.type(screen.getByLabelText("Seed"), "4321");

    await user.click(screen.getByRole("button", { name: "Start processing" }));

    expect(onConfirm).toHaveBeenCalledWith({
      preset: "upscale-2x",
      seed: 4321,
      promptText: "",
      overwriteCandidates: false,
    });
  });

  it("leaves the preset's own seeds alone when the field is empty", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    await screen.findByLabelText("Workflow");
    await user.click(screen.getByRole("button", { name: "Start processing" }));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ seed: null, preset: "fix-faces" }),
    );
  });

  it("sends the prompt for the preset's DataForge Prompt node", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    await screen.findByLabelText("Workflow");
    await user.type(screen.getByLabelText("Prompt"), "sharp studio photograph");

    await user.click(screen.getByRole("button", { name: "Start processing" }));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ promptText: "sharp studio photograph" }),
    );
  });

  it("starts from the prompt the last run used", async () => {
    renderDialog(settings({ prompt_text: "no watermark" }));

    expect(await screen.findByLabelText("Prompt")).toHaveValue("no watermark");
  });

  // An all-whitespace box is the same request as an empty one - run the graph as saved -
  // and the backend tells the two apart, so the trim has to happen before it is sent.
  it("treats a whitespace-only prompt as none at all", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    await screen.findByLabelText("Workflow");
    await user.type(screen.getByLabelText("Prompt"), "   ");

    await user.click(screen.getByRole("button", { name: "Start processing" }));

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ promptText: "" }));
  });

  it("names the nodes the prompt and seed are written into", async () => {
    renderDialog();

    expect(await screen.findByText(/DataForge Prompt/)).toBeInTheDocument();
    expect(screen.getByText(/DataForge Seed/)).toBeInTheDocument();
  });

  // The field is `type="number"`, so the browser already turns letters away. What it
  // still lets through is a sign and a decimal point, and a seed is neither.
  it("refuses a seed that is not a whole number", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    await screen.findByLabelText("Workflow");
    await user.type(screen.getByLabelText("Seed"), "-5");

    await user.click(screen.getByRole("button", { name: "Start processing" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("whole number");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("reports a failure to list presets", async () => {
    fetchPresets.mockRejectedValue(new Error("Backend is down"));

    renderDialog();

    expect(await screen.findByRole("alert")).toHaveTextContent("Backend is down");
  });
});
