import { describe, expect, it } from "vitest";
import type { ComfyMapNode } from "@/shared/types";
import { layoutWorkflowMap, splitLabel } from "./workflowMapLayout";

function box(
  id: string,
  kind: ComfyMapNode["kind"],
  feeds: string[],
  status: ComfyMapNode["status"] = "ran",
): ComfyMapNode {
  return { id, kind, label: id, detail: [], status, feeds };
}

/** Points along an SVG path of M, L, Q and C commands, so a test can see what it crosses. */
function sample(path: string): [number, number][] {
  const tokens = path.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  const points: [number, number][] = [];
  let at: [number, number] = [0, 0];
  let index = 0;
  const read = (): [number, number] => [Number(tokens[index++]), Number(tokens[index++])];
  while (index < tokens.length) {
    const command = tokens[index++];
    const controls = command === "M" || command === "L" ? 1 : command === "Q" ? 2 : 3;
    const [start, ...rest] = [at, ...Array.from({ length: controls }, read)];
    for (let step = 1; step <= 20 && command !== "M"; step++) {
      const t = step / 20;
      // De Casteljau over whichever control points this command has.
      let level = [start, ...rest];
      while (level.length > 1) {
        level = level
          .slice(1)
          .map(([x, y], i) => [
            level[i][0] + (x - level[i][0]) * t,
            level[i][1] + (y - level[i][1]) * t,
          ]);
      }
      points.push(level[0] as [number, number]);
    }
    at = rest[rest.length - 1];
  }
  return points;
}

/** Where a path ends: the point it meets its target at. */
function end(path: string): { x: number; y: number } {
  const [x, y] = sample(path).at(-1)!;
  return { x, y };
}

// A checkpoint and prompt feed the base pass, which feeds a bypassed detailer and, around it,
// the output.
const MAP = [
  box("model", "model", ["base"]),
  box("prompt", "prompt", ["base"]),
  box("base", "pass", ["detailer", "out"]),
  box("detailer", "pass", ["out"], "bypassed"),
  box("out", "output", []),
];

const SEMANTIC_MAP: ComfyMapNode[] = [
  box("model-a", "model", ["lora-a"]),
  box("model-b", "model", ["lora-b"]),
  box("lora-a", "loras", ["base", "refine"]),
  box("lora-b", "loras", ["base"]),
  box("clip", "clip", ["positive", "negative"]),
  box("vae", "vae", ["base", "out"]),
  box("image", "input", ["base"]),
  { ...box("positive", "prompt", ["base", "refine"]), role: "positive" },
  { ...box("negative", "prompt", ["base", "refine"]), role: "negative" },
  box("base", "pass", ["refine", "out"]),
  box("refiner-model", "model", ["refine"]),
  box("refine", "pass", ["out"]),
  box("out", "output", []),
];

describe("layoutWorkflowMap", () => {
  const layout = layoutWorkflowMap(MAP);
  const placed = (id: string) => layout.nodes.find((node) => node.node.id === id)!;

  it("puts each box a row below the boxes it reads, the output last", () => {
    expect(placed("base").y).toBeLessThan(placed("detailer").y);
    expect(placed("detailer").y).toBeLessThan(placed("out").y);
    expect(Math.max(...layout.nodes.map((node) => node.y))).toBe(placed("out").y);
  });

  it("keeps the pass wider than preparations in separate columns", () => {
    expect(placed("model").width).toBeLessThan(placed("base").width);
  });

  it("sets sources side by side just above the box they feed", () => {
    expect(placed("model").y).toBe(placed("prompt").y);
    expect(placed("prompt").x).toBeGreaterThanOrEqual(placed("model").x + placed("model").width);
    expect(placed("model").y).toBeLessThan(placed("base").y);
  });

  it("introduces a later source in the preparation section of its first reader", () => {
    const late = layoutWorkflowMap([
      box("model", "model", ["base"]),
      box("base", "pass", ["refine"]),
      box("upscaler", "model", ["refine"]),
      box("refine", "pass", ["out"]),
      box("out", "output", []),
    ]);
    const y = (id: string) => late.nodes.find((node) => node.node.id === id)!.y;

    expect(y("upscaler")).toBeGreaterThan(y("base"));
    expect(y("upscaler")).toBeLessThan(y("refine"));
    // Straight down into the next row: it leaves from the box's bottom, not through a lane.
    const upscaler = late.nodes.find((node) => node.node.id === "upscaler")!;
    const edge = late.edges.find((candidate) => candidate.from === "upscaler")!;
    expect(edge.path.startsWith(`M ${upscaler.x + upscaler.width / 2} `)).toBe(true);
  });

  it("runs an edge that skips rows between the boxes of the rows it passes", () => {
    // Preparations share columns, and the model feeds both the base pass and the output.
    const crowded = layoutWorkflowMap([
      box("model", "model", ["base", "out"]),
      box("lora", "loras", ["base"]),
      box("prompt", "prompt", ["base"]),
      box("upscaler", "model", ["base"]),
      box("base", "pass", ["out"]),
      box("out", "output", []),
    ]);
    const skip = crowded.edges.find((edge) => edge.from === "model" && edge.to === "out")!;
    const points = sample(skip.path);
    const inside = (x: number, y: number) =>
      crowded.nodes.some(
        (node) =>
          x > node.x + 0.01 &&
          x < node.x + node.width - 0.01 &&
          y > node.y + 0.01 &&
          y < node.y + node.height - 0.01,
      );

    expect(points.filter(([x, y]) => inside(x, y))).toEqual([]);
    // Shared connections can use the gutters beside their semantic column.
    const xs = points.map(([x]) => x);
    expect(Math.max(...xs)).toBeLessThanOrEqual(crowded.width);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    // It comes in from the top of its target.
    const out = crowded.nodes.find((node) => node.node.id === "out")!;
    const { x: endX, y: endY } = end(skip.path);
    expect(endY).toBeCloseTo(out.y);
    expect(endX).toBeGreaterThan(out.x);
    expect(endX).toBeLessThan(out.x + out.width);
  });

  it("widens preparation columns with the map, but never lays out below its minimum width", () => {
    const row = [
      box("a", "model", ["base"]),
      box("b", "loras", ["base"]),
      box("c", "prompt", ["base"]),
      box("d", "input", ["base"]),
      box("base", "pass", []),
    ];
    const boxWidth = (layout: ReturnType<typeof layoutWorkflowMap>) =>
      layout.nodes.find((node) => node.node.id === "a")!.width;
    const narrow = layoutWorkflowMap(row);
    const wide = layoutWorkflowMap(row, 960);

    expect(wide.width).toBe(960);
    expect(boxWidth(wide)).toBeGreaterThan(boxWidth(narrow) * 1.5);
    expect(Math.max(...wide.nodes.map((node) => node.x + node.width))).toBeLessThanOrEqual(960);
    expect(layoutWorkflowMap(row, 200).width).toBe(narrow.width);
  });

  it("groups independent preparations with their consumer despite the source listing order", () => {
    const swapped = layoutWorkflowMap([
      box("first", "model", ["late"]),
      box("second", "model", ["early"]),
      box("early", "pass", ["out"]),
      box("late", "pass", ["out"]),
      box("out", "output", []),
    ]);
    const y = (id: string) => swapped.nodes.find((node) => node.node.id === id)!.y;

    expect(y("second")).toBeLessThan(y("early"));
    expect(y("early")).toBeLessThan(y("first"));
    expect(y("first")).toBeLessThan(y("late"));
  });

  it("closes the map with the output even when nothing reached it", () => {
    const unlinked = layoutWorkflowMap([
      box("model", "model", ["base"]),
      box("base", "pass", []),
      box("out", "output", []),
    ]);
    const y = (id: string) => unlinked.nodes.find((node) => node.node.id === id)!.y;

    expect(y("out")).toBeGreaterThan(y("base"));
  });

  it("fans edges that share a box out along it, ordered by their other end", () => {
    const fanned = layoutWorkflowMap([
      box("model", "model", ["base"]),
      box("lora", "loras", ["base"]),
      box("prompt", "prompt", ["base"]),
      box("base", "pass", ["out"]),
      box("out", "output", []),
    ]);
    const target = fanned.nodes.find((node) => node.node.id === "base")!;
    const incomingX = (path: string) => {
      const points = sample(path);
      const y = target.y - 18;
      const index = points.findIndex(([, pointY]) => pointY >= y);
      const [a, b] = [points[index - 1], points[index]];
      return a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]);
    };
    const into = fanned.edges
      .filter((edge) => edge.to === "base")
      .sort((a, b) => incomingX(a.path) - incomingX(b.path))
      .map((edge) => end(edge.path).x);

    // Left to right like their incoming wires, so they never cross as they meet the target.
    expect(into).toEqual([...into].sort((a, b) => a - b));
    expect(new Set(into).size).toBe(3);
  });

  it("marks edges into or out of a box that did not run", () => {
    const ran = Object.fromEntries(
      layout.edges.map((edge) => [`${edge.from}>${edge.to}`, edge.ran]),
    );

    expect(ran).toEqual({
      "model>base": true,
      "prompt>base": true,
      "base>detailer": false,
      "base>out": true,
      "detailer>out": false,
    });
  });

  it("keeps model, conditioning and media preparations in consistent columns", () => {
    const grouped = layoutWorkflowMap(SEMANTIC_MAP);
    const x = (id: string) => grouped.nodes.find((node) => node.node.id === id)!.x;

    for (const group of [
      ["model-a", "model-b", "lora-a", "lora-b", "refiner-model"],
      ["clip", "positive", "negative"],
      ["vae", "image"],
    ]) {
      const xs = group.map(x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(24);
    }
    expect(x("lora-a")).toBeLessThan(x("positive"));
    expect(x("positive")).toBeLessThan(x("image"));
  });

  it("uses more height to keep crowded preparations readable and wires clear of boxes", () => {
    const grouped = layoutWorkflowMap(SEMANTIC_MAP);
    expect(Math.min(...grouped.nodes.map((node) => node.width))).toBeGreaterThanOrEqual(120);
    for (const edge of grouped.edges) {
      const intersects = sample(edge.path).some(([x, y]) =>
        grouped.nodes.some(
          (node) =>
            x > node.x + 0.01 &&
            x < node.x + node.width - 0.01 &&
            y > node.y + 0.01 &&
            y < node.y + node.height - 0.01,
        ),
      );
      expect(intersects, `${edge.from} -> ${edge.to}`).toBe(false);
    }
  });

  it("draws shared connections with long curves instead of a bend at every row", () => {
    const grouped = layoutWorkflowMap(SEMANTIC_MAP);
    const shared = grouped.edges.find((edge) => edge.from === "vae" && edge.to === "out")!;

    expect(shared.path).not.toContain("L");
    expect(shared.path.match(/C/g)!.length).toBeLessThanOrEqual(3);
  });

  it("places every dependency above its consumer and keeps boxes apart", () => {
    const grouped = layoutWorkflowMap(SEMANTIC_MAP);
    for (const edge of grouped.edges) {
      const from = grouped.nodes.find((node) => node.node.id === edge.from)!;
      const to = grouped.nodes.find((node) => node.node.id === edge.to)!;
      expect(from.y + from.height).toBeLessThan(to.y);
    }
    for (const [index, node] of grouped.nodes.entries()) {
      for (const other of grouped.nodes.slice(index + 1)) {
        expect(
          node.x + node.width <= other.x ||
            other.x + other.width <= node.x ||
            node.y + node.height <= other.y ||
            other.y + other.height <= node.y,
        ).toBe(true);
      }
    }
  });
});

describe("splitLabel", () => {
  it("keeps a file name's end apart so the cut falls in the middle", () => {
    expect(splitLabel("smoothMixWan2214BI2V_i2vV20High", true)).toEqual({
      head: "smoothMixWan2214BI2V_i2vV2",
      tail: "0High",
    });
    expect(splitLabel("smoothMixWan2214BI2V_i2vV20Low", true).tail).toBe("20Low");
  });

  it("leaves short names and other labels whole", () => {
    expect(splitLabel("landscape", true)).toEqual({ head: "landscape", tail: "" });
    expect(splitLabel("TripleKSampler (Simple)", false).tail).toBe("");
  });
});
