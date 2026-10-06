import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/features/gallery/api/captions";
import { installMockBackend } from "@/test/mockBackend";
import type { ComfyOutputBranch, ComfyWorkflowPromptsResponse } from "@/shared/types";
import { ComfyWorkflowDialog } from "./ComfyWorkflowDialog";
import { renderWithQueryClient } from "@/test/queryClient";

function makeBranch(overrides: Partial<ComfyOutputBranch> = {}): ComfyOutputBranch {
  return {
    node_id: "7",
    class_type: "SaveImage",
    label: "Text to Image",
    filename_prefix: "scenery",
    is_preview: false,
    matches_filename: false,
    prompts: [],
    parameters: [],
    loras: [],
    stages: [],
    map: [],
    ...overrides,
  };
}

function makeResponse(
  overrides: Partial<ComfyWorkflowPromptsResponse> = {},
): ComfyWorkflowPromptsResponse {
  return {
    has_workflow: true,
    branches: [],
    matched_node_id: null,
    orphan_prompts: [],
    has_editor_workflow: false,
    matched_by_size: false,
    ...overrides,
  };
}

function renderDialog(response: ComfyWorkflowPromptsResponse) {
  vi.spyOn(api, "fetchComfyWorkflowPrompts").mockResolvedValue(response);
  return renderWithQueryClient(
    <ComfyWorkflowDialog
      mediaPath="C:\\Photos\\scenery_00002_.png"
      mediaName="scenery_00002_.png"
      onClose={() => {}}
    />,
  );
}

describe("ComfyWorkflowDialog", () => {
  beforeEach(() => {
    installMockBackend();
    vi.restoreAllMocks();
  });

  it("opens on the likely output and keeps its badge when inspecting another branch", async () => {
    const user = userEvent.setup();
    renderDialog(
      makeResponse({
        matched_node_id: "8",
        branches: [
          makeBranch({
            node_id: "8",
            matches_filename: true,
            label: "Text to Image",
            prompts: [
              {
                role: "positive",
                text: "a harbour at night",
                node_id: "3",
                node_title: "Positive Prompt",
                input_name: "positive",
              },
            ],
          }),
          makeBranch({
            node_id: "7",
            label: "Upscale",
            prompts: [
              {
                role: "positive",
                text: "a forest path in fog",
                node_id: "2",
                node_title: "Positive Prompt",
                input_name: "positive",
              },
            ],
          }),
        ],
      }),
    );

    const shown = within(await screen.findByRole("group", { name: "Details" }));
    expect(shown.getByText("a harbour at night")).toBeInTheDocument();
    expect(shown.queryByText("a forest path in fog")).not.toBeInTheDocument();
    expect(shown.getByText("Node #8 · SaveImage")).toBeInTheDocument();
    expect(shown.getByText("Filename prefix: scenery")).toBeInTheDocument();
    expect(shown.getByText("Likely output — matched by filename")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Upscale/ }));
    const comparison = within(screen.getByRole("group", { name: "Details" }));
    expect(comparison.getByText("a forest path in fog")).toBeInTheDocument();
    expect(comparison.getByText("Selected for inspection — source unverified")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Text to Image/ })).toHaveTextContent(
      "Likely output — matched by filename",
    );
  });

  it("switches the shown prompts when another output is picked", async () => {
    const user = userEvent.setup();
    renderDialog(
      makeResponse({
        branches: [
          makeBranch({
            node_id: "8",
            label: "Harbour shot",
            prompts: [
              {
                role: "positive",
                text: "a harbour at night",
                node_id: "3",
                node_title: "Positive Prompt",
                input_name: "positive",
              },
            ],
          }),
          makeBranch({
            node_id: "7",
            label: "Forest shot",
            prompts: [
              {
                role: "positive",
                text: "a forest path in fog",
                node_id: "2",
                node_title: "Positive Prompt",
                input_name: "positive",
              },
            ],
          }),
        ],
      }),
    );

    // Without a filename match the first output is still shown, never an empty pane.
    expect(
      within(await screen.findByRole("group", { name: "Details" })).getByText("a harbour at night"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Harbour shot/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByText(/The saved names do not identify/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Forest shot/ }));

    const shown = within(screen.getByRole("group", { name: "Details" }));
    expect(shown.getByText("a forest path in fog")).toBeInTheDocument();
    expect(shown.queryByText("a harbour at night")).not.toBeInTheDocument();
  });

  it("says so when several outputs claim the filename", async () => {
    renderDialog(
      makeResponse({
        branches: [
          makeBranch({ node_id: "8", matches_filename: true, filename_prefix: "shot" }),
          makeBranch({ node_id: "7", matches_filename: true, filename_prefix: "shot" }),
        ],
      }),
    );

    expect(await screen.findByText(/2 outputs share a naming pattern/)).toBeInTheDocument();
    const shown = within(screen.getByRole("group", { name: "Details" }));
    expect(shown.getByText("Node #8 · SaveImage")).toBeInTheDocument();
    expect(shown.getByText("Selected for inspection — source unverified")).toBeInTheDocument();
  });

  it("shows the identity and uncertainty of a single unmatched output", async () => {
    renderDialog(
      makeResponse({
        branches: [
          makeBranch({
            node_id: "7:12",
            class_type: "SwiftVRRestoreVideo",
            label: "Restored video",
            filename_prefix: null,
            filename: "renders/scene.mp4",
          }),
        ],
      }),
    );
    const shown = within(await screen.findByRole("group", { name: "Selected output" }));
    expect(shown.getByText("Restored video")).toBeInTheDocument();
    expect(shown.getByText("Node #7:12 · SwiftVRRestoreVideo")).toBeInTheDocument();
    expect(shown.getByText("Filename: renders/scene.mp4")).toBeInTheDocument();
    expect(
      shown.getByText("Only output in embedded workflow — filename unverified"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Workflow outputs" })).not.toBeInTheDocument();
  });

  it("shows a likely single output even without an output list", async () => {
    renderDialog(
      makeResponse({
        matched_node_id: "7",
        branches: [makeBranch({ matches_filename: true })],
      }),
    );
    expect(await screen.findByText("Likely output — matched by filename")).toBeInTheDocument();
    expect(screen.getByText("Node #7 · SaveImage")).toBeInTheDocument();
  });

  it("lists model files apart from settings and splits LoRA strengths off their names", async () => {
    renderDialog(
      makeResponse({
        branches: [
          makeBranch({
            parameters: [
              { label: "Model", value: "base_model.safetensors" },
              { label: "Steps", value: "12" },
            ],
            loras: ["styles\\soft_light.safetensors (0.6)", "detail.safetensors"],
          }),
        ],
      }),
    );
    const models = (await screen.findByText("Models")).parentElement!;
    // Long names truncate; the title carries the full one.
    expect(within(models).getByText("base_model.safetensors")).toHaveAttribute(
      "title",
      "base_model.safetensors",
    );
    const settings = screen.getByText("Settings").parentElement!;
    expect(within(settings).getByText("12")).toBeInTheDocument();
    expect(within(settings).queryByText("base_model.safetensors")).not.toBeInTheDocument();
    const loras = within(screen.getByText("LoRAs").parentElement!).getAllByRole("listitem");
    expect(loras[0]).toHaveTextContent(/^styles\\soft_light\.safetensors0\.6$/);
    expect(within(loras[0]).getByText("0.6")).toBeInTheDocument();
    expect(within(loras[0]).getByTitle("styles\\soft_light.safetensors")).toBeInTheDocument();
    expect(loras[1]).toHaveTextContent(/^detail\.safetensors$/);
  });

  it("shows a single-pass output's settings without pass headings", async () => {
    renderDialog(
      makeResponse({
        branches: [makeBranch({ parameters: [{ label: "Steps", value: "20" }] })],
      }),
    );
    expect(await screen.findByText("20")).toBeInTheDocument();
    expect(screen.queryByText(/^Pass \d/)).not.toBeInTheDocument();
    expect(screen.queryByText("Shared")).not.toBeInTheDocument();
  });

  it("groups settings by sampling pass and marks a switched-off pass as skipped", async () => {
    renderDialog(
      makeResponse({
        branches: [
          makeBranch({
            node_id: "10",
            parameters: [{ label: "Model", value: "base_model.safetensors" }],
            stages: [
              {
                node_id: "4",
                label: "KSampler",
                group: "Text to Image",
                status: "ran",
                parameters: [{ label: "Steps", value: "30" }],
                loras: [],
              },
              {
                node_id: "7",
                label: "High-res pass",
                group: null,
                status: "switched_off",
                parameters: [{ label: "Steps", value: "6" }],
                loras: ["detail.safetensors (0.8)"],
              },
            ],
          }),
        ],
      }),
    );
    const shared = await screen.findByRole("region", { name: "Shared settings" });
    expect(within(shared).getByText("base_model.safetensors")).toBeInTheDocument();
    const base = screen.getByRole("region", { name: "Pass 1: KSampler" });
    expect(within(base).getByText("30")).toBeInTheDocument();
    expect(within(base).getByText("Text to Image")).toBeInTheDocument();
    expect(within(base).queryByText(/Skipped/)).not.toBeInTheDocument();
    const refine = screen.getByRole("region", { name: "Pass 2: High-res pass, skipped" });
    expect(within(refine).getByText("Skipped — switched off")).toBeInTheDocument();
    expect(within(refine).getByText("6")).toBeInTheDocument();
    expect(within(refine).getByText("detail.safetensors")).toBeInTheDocument();
    expect(within(base).queryByText("6")).not.toBeInTheDocument();
  });

  it("opens a pass's settings from the workflow map below the passes", async () => {
    const user = userEvent.setup();
    const scrolled: Element[] = [];
    // jsdom does not scroll, so it has no scrollIntoView to spy on.
    Element.prototype.scrollIntoView ??= () => {};
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
      scrolled.push(this);
    });
    renderDialog(
      makeResponse({
        branches: [
          makeBranch({
            stages: [
              {
                node_id: "4",
                label: "KSampler",
                status: "ran",
                parameters: [{ label: "Steps", value: "30" }],
                loras: [],
              },
              {
                node_id: "6",
                label: "FaceDetailer",
                status: "bypassed",
                parameters: [{ label: "Steps", value: "8" }],
                loras: [],
              },
            ],
            map: [
              {
                id: "4",
                kind: "pass",
                label: "KSampler",
                detail: [],
                status: "ran",
                feeds: ["6", "7"],
              },
              {
                id: "6",
                kind: "pass",
                label: "FaceDetailer",
                detail: [],
                status: "bypassed",
                feeds: ["7"],
              },
              { id: "7", kind: "output", label: "Output", detail: [], status: "ran", feeds: [] },
            ],
          }),
        ],
      }),
    );
    const map = await screen.findByRole("group", { name: "Workflow map" });
    await user.click(within(map).getByRole("button", { name: "Pass 2: FaceDetailer, bypassed" }));

    expect(scrolled).toEqual([
      screen.getByRole("region", { name: "Pass 2: FaceDetailer, bypassed" }),
    ]);
  });

  it("marks a bypassed pass and says when the workflow kept none of its settings", async () => {
    renderDialog(
      makeResponse({
        branches: [
          makeBranch({
            stages: [
              {
                node_id: "4",
                label: "KSampler",
                status: "ran",
                parameters: [{ label: "Steps", value: "30" }],
                loras: [],
              },
              {
                node_id: "6",
                label: "FaceDetailer",
                status: "bypassed",
                parameters: [],
                loras: [],
              },
            ],
          }),
        ],
      }),
    );
    const detailer = await screen.findByRole("region", {
      name: "Pass 2: FaceDetailer, bypassed",
    });
    expect(within(detailer).getByText("Bypassed")).toBeInTheDocument();
    expect(
      within(detailer).getByText("The workflow does not record this bypassed node's settings."),
    ).toBeInTheDocument();
  });

  it("reports missing saved names without inventing filename evidence", async () => {
    renderDialog(
      makeResponse({ branches: [makeBranch({ filename_prefix: null, is_preview: true })] }),
    );
    expect(await screen.findByText("Saved name not recorded")).toBeInTheDocument();
    expect(
      screen.getByText("Only output in embedded workflow — filename unverified"),
    ).toBeInTheDocument();
  });

  it("reports a file that carries no workflow", async () => {
    renderDialog(makeResponse({ has_workflow: false }));

    expect(await screen.findByText(/carries no ComfyUI workflow/)).toBeInTheDocument();
  });

  it("says when the output size decided between same-named outputs", async () => {
    renderDialog(
      makeResponse({
        matched_node_id: "9",
        matched_by_size: true,
        branches: [
          makeBranch({ matches_filename: true }),
          makeBranch({ node_id: "9", label: "Upscale", matches_filename: true }),
        ],
      }),
    );

    expect(await screen.findByText(/only\s+one is set to render at its size/)).toBeInTheDocument();
    expect(
      screen.getAllByText("Likely output — matched by filename and size").length,
    ).toBeGreaterThan(0);
  });

  it("copies the workflow of the selected output for pasting into ComfyUI", async () => {
    const user = userEvent.setup();
    const workflow = '{"version": 0.4, "nodes": [], "extra": {}}';
    const fetchWorkflow = vi.spyOn(api, "fetchComfyEditorWorkflow").mockResolvedValue(workflow);
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    renderDialog(
      makeResponse({
        branches: [makeBranch(), makeBranch({ node_id: "9", label: "Upscale" })],
        has_editor_workflow: true,
      }),
    );

    await user.click(await screen.findByRole("button", { name: /Upscale/ }));
    await user.click(screen.getByRole("button", { name: "Copy workflow" }));

    expect(fetchWorkflow).toHaveBeenCalledWith(expect.stringMatching(/scenery_00002_\.png$/), "9");
    expect(writeText).toHaveBeenCalledWith(workflow);
    expect(await screen.findByRole("button", { name: "Copied!" })).toHaveClass(
      "comfy-workflow-dialog__copy--copied",
    );
  });

  it("reports a workflow that could not be fetched as a failed copy", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "fetchComfyEditorWorkflow").mockRejectedValue(new Error("Not found"));
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderDialog(makeResponse({ branches: [makeBranch()], has_editor_workflow: true }));

    await user.click(await screen.findByRole("button", { name: "Copy workflow" }));

    expect(await screen.findByRole("button", { name: "Failed!" })).toHaveClass(
      "comfy-workflow-dialog__copy--error",
    );
    expect(writeText).not.toHaveBeenCalled();
  });

  it("offers no workflow copy when ComfyUI could not paste what the file carries", async () => {
    renderDialog(makeResponse({ branches: [makeBranch()] }));

    expect(await screen.findByText("Filename prefix: scenery")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy workflow" })).not.toBeInTheDocument();
  });

  it("surfaces a failed read instead of an empty panel", async () => {
    vi.spyOn(api, "fetchComfyWorkflowPrompts").mockRejectedValue(new Error("Backend unreachable"));

    renderWithQueryClient(
      <ComfyWorkflowDialog
        mediaPath="C:\\Photos\\scenery_00002_.png"
        mediaName="scenery_00002_.png"
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Backend unreachable/)).toBeInTheDocument();
    });
  });
});
