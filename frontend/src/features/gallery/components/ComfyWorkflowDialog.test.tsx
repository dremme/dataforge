import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/features/gallery/api/captions";
import { installMockBackend } from "@/test/mockBackend";
import type { ComfyOutputBranch, ComfyWorkflowPromptsResponse } from "@/shared/types";
import { ComfyWorkflowDialog } from "./ComfyWorkflowDialog";

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
  return render(
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

  it("opens on the output that wrote the file", async () => {
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

    const shown = within(await screen.findByRole("group", { name: "Prompts" }));
    expect(shown.getByText("a harbour at night")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Forest shot/ }));

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

    expect(await screen.findByText(/2 outputs write under the same filename/)).toBeInTheDocument();
  });

  it("reports a file that carries no workflow", async () => {
    renderDialog(makeResponse({ has_workflow: false }));

    expect(await screen.findByText(/carries no ComfyUI workflow/)).toBeInTheDocument();
  });

  it("surfaces a failed read instead of an empty panel", async () => {
    vi.spyOn(api, "fetchComfyWorkflowPrompts").mockRejectedValue(new Error("Backend unreachable"));

    render(
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
