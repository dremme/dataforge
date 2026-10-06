import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ComfyMapNode } from "@/shared/types";
import { ComfyWorkflowMap } from "./ComfyWorkflowMap";

const MAP: ComfyMapNode[] = [
  {
    id: "1",
    kind: "model",
    label: "landscape",
    detail: ["models/landscape.safetensors"],
    status: "ran",
    feeds: ["4"],
  },
  {
    id: "prompt:3:negative",
    kind: "prompt",
    label: "blurry",
    detail: ["blurry"],
    status: "ran",
    feeds: ["4"],
    role: "negative",
  },
  { id: "4", kind: "pass", label: "KSampler", detail: [], status: "ran", feeds: ["6", "7"] },
  { id: "6", kind: "pass", label: "FaceDetailer", detail: [], status: "bypassed", feeds: ["7"] },
  { id: "7", kind: "output", label: "Output", detail: [], status: "ran", feeds: [] },
];
// Edges render in the order of each box's feeds, boxes in map order.
const EDGES = MAP.flatMap((node) => node.feeds.map((target) => `${node.id}>${target}`));
const NUMBERS = new Map([
  ["4", 1],
  ["6", 2],
]);

const SETTINGS = new Map([
  [
    "4",
    [
      { label: "Seed", value: "42" },
      { label: "Steps", value: "30" },
      { label: "Width", value: "1024" },
    ],
  ],
]);

function renderMap(onSelect?: (nodeId: string) => void) {
  return render(
    <ComfyWorkflowMap
      map={MAP}
      passNumbers={NUMBERS}
      passSettings={SETTINGS}
      output="Text to Image"
      onSelect={onSelect}
    />,
  );
}

/** The box whose visible label is ``label``. */
function box(label: string): HTMLElement {
  return screen.getByText(label).closest(".comfy-workflow-dialog__map-node") as HTMLElement;
}

describe("ComfyWorkflowMap", () => {
  it("opens a pass from the map by click or keyboard, and only passes", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderMap(onSelect);

    await user.click(screen.getByRole("button", { name: "Pass 2: FaceDetailer, bypassed" }));
    screen.getByRole("button", { name: "Pass 1: KSampler" }).focus();
    await user.keyboard("{Enter}");

    expect(onSelect.mock.calls).toEqual([["6"], ["4"]]);
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("traces a box's edges on hover and dims the rest until the pointer leaves", () => {
    const { container } = renderMap();
    const map = screen.getByRole("group", { name: "Workflow map" });
    const edges = container.querySelectorAll(".comfy-workflow-dialog__map-edge");
    const edge = (from: string, to: string) => edges[EDGES.indexOf(`${from}>${to}`)];
    const lit = (element: Element) =>
      element.classList.contains("comfy-workflow-dialog__map-edge--lit");

    fireEvent.mouseEnter(box("FaceDetailer"));

    expect(map).toHaveClass("comfy-workflow-dialog__map--tracing");
    expect([lit(edge("4", "6")), lit(edge("6", "7")), lit(edge("4", "7"))]).toEqual([
      true,
      true,
      false,
    ]);
    expect(box("KSampler")).toHaveClass("comfy-workflow-dialog__map-node--lit");
    expect(box("landscape")).not.toHaveClass("comfy-workflow-dialog__map-node--lit");
    fireEvent.mouseLeave(box("FaceDetailer"));
    expect(map).not.toHaveClass("comfy-workflow-dialog__map--tracing");
  });

  it("shows a pass's kind, state and leading settings in a tooltip", async () => {
    const user = userEvent.setup();
    renderMap(() => {});

    await user.hover(box("KSampler"));
    const tip = await screen.findByRole("tooltip");

    expect(tip).toHaveTextContent("Pass 1");
    expect(within(tip).getByText("Steps").nextSibling).toHaveTextContent("30");
    expect(within(tip).getByText("Seed")).toBeInTheDocument();
    // Only the settings that say what a pass did; the rest are in its section.
    expect(within(tip).queryByText("Width")).not.toBeInTheDocument();
    expect(tip).toHaveTextContent("Click to show its settings");
  });

  it("names a bypassed box's state and a model's full path in their tooltips", async () => {
    const user = userEvent.setup();
    renderMap();

    // Looked up first: once its tooltip is open, the label shows twice.
    const detailer = box("FaceDetailer");
    const model = box("landscape");
    await user.hover(detailer);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Bypassed");
    await user.unhover(detailer);

    await user.hover(model);
    await waitFor(() =>
      expect(screen.getByRole("tooltip")).toHaveTextContent("models/landscape.safetensors"),
    );
  });

  it("keeps a file name's end visible when its label has to be cut", () => {
    render(
      <ComfyWorkflowMap
        map={[
          {
            id: "1",
            kind: "model",
            label: "smoothMixWan2214BI2V_i2vV20High",
            detail: [],
            status: "ran",
            feeds: ["2"],
          },
          { id: "2", kind: "pass", label: "KSampler", detail: [], status: "ran", feeds: ["3"] },
          { id: "3", kind: "output", label: "Output", detail: [], status: "ran", feeds: [] },
        ]}
        passNumbers={new Map([["2", 1]])}
        passSettings={new Map()}
        output="Text to Image"
      />,
    );

    expect(screen.getByText("0High")).toHaveClass("comfy-workflow-dialog__map-label-tail");
  });

  it("names a generated input by its stage and prompt, and a loaded one by its file", async () => {
    const user = userEvent.setup();
    const prompt = "a red bicycle against a brick wall, photographed at noon";
    render(
      <ComfyWorkflowMap
        map={[
          {
            id: "5",
            kind: "input",
            label: prompt,
            detail: [prompt],
            status: "ran",
            feeds: ["8"],
            media: "image",
            source: "Reference image",
          },
          {
            id: "11",
            kind: "input",
            label: "voice",
            detail: ["clips/voice.wav"],
            status: "ran",
            feeds: ["8"],
            media: "audio",
          },
          { id: "8", kind: "pass", label: "KSampler", detail: [], status: "ran", feeds: ["10"] },
          { id: "10", kind: "output", label: "Output", detail: [], status: "ran", feeds: [] },
        ]}
        passNumbers={new Map([["8", 1]])}
        passSettings={new Map()}
        output="Image to Video"
      />,
    );

    // A prompt is prose, so it is cut at its end, not split like a file name.
    const generated = box(prompt);
    expect(generated.querySelector(".comfy-workflow-dialog__map-label-tail")).toBeNull();
    await user.hover(generated);
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("Generated image");
    expect(tip).toHaveTextContent("Reference image");
    await user.unhover(generated);

    await user.hover(box("voice"));
    await waitFor(() => expect(screen.getByRole("tooltip")).toHaveTextContent("Audio input"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("clips/voice.wav");
  });
});
