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

    const shown = within(await screen.findByRole("group", { name: "Prompts" }));
    expect(shown.getByText("a harbour at night")).toBeInTheDocument();
    expect(shown.queryByText("a forest path in fog")).not.toBeInTheDocument();
    expect(shown.getByText("Node #8 · SaveImage")).toBeInTheDocument();
    expect(shown.getByText("Filename prefix: scenery")).toBeInTheDocument();
    expect(shown.getByText("Likely output — matched by filename")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Upscale/ }));
    const comparison = within(screen.getByRole("group", { name: "Prompts" }));
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
      within(await screen.findByRole("group", { name: "Prompts" })).getByText("a harbour at night"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Harbour shot/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByText(/The saved names do not identify/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Forest shot/ }));

    const shown = within(screen.getByRole("group", { name: "Prompts" }));
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
    const shown = within(screen.getByRole("group", { name: "Prompts" }));
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
    expect(within(models).getByText("base_model.safetensors")).toBeInTheDocument();
    const settings = screen.getByText("Settings").parentElement!;
    expect(within(settings).getByText("12")).toBeInTheDocument();
    expect(within(settings).queryByText("base_model.safetensors")).not.toBeInTheDocument();
    const loras = within(screen.getByText("LoRAs").parentElement!).getAllByRole("listitem");
    expect(loras[0]).toHaveTextContent(/^styles\\soft_light\.safetensors0\.6$/);
    expect(within(loras[0]).getByText("0.6")).toBeInTheDocument();
    expect(loras[1]).toHaveTextContent(/^detail\.safetensors$/);
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
