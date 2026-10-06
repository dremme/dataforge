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

describe("layoutWorkflowMap", () => {
  const layout = layoutWorkflowMap(MAP);
  const placed = (id: string) => layout.nodes.find((node) => node.node.id === id)!;

  it("puts each box a row below the boxes it reads, the output last", () => {
    expect(placed("base").y).toBeLessThan(placed("detailer").y);
    expect(placed("detailer").y).toBeLessThan(placed("out").y);
    expect(Math.max(...layout.nodes.map((node) => node.y))).toBe(placed("out").y);
  });

  it("sizes each row's boxes to that row, so a crowded row narrows only itself", () => {
    expect(placed("model").width).toBeLessThan(placed("base").width);
  });

  it("sets sources side by side just above the box they feed", () => {
    expect(placed("model").y).toBe(placed("prompt").y);
    expect(placed("prompt").x).toBeGreaterThanOrEqual(placed("model").x + placed("model").width);
    expect(placed("model").y).toBeLessThan(placed("base").y);
  });

  it("lifts a source only as far as its first reader, not to the top", () => {
    const late = layoutWorkflowMap([
      box("model", "model", ["base"]),
      box("base", "pass", ["refine"]),
      box("upscaler", "model", ["refine"]),
      box("refine", "pass", ["out"]),
      box("out", "output", []),
    ]);
    const y = (id: string) => late.nodes.find((node) => node.node.id === id)!.y;

    expect(y("upscaler")).toBe(y("base"));
    // Straight down into the next row: it leaves from the box's bottom, not through a lane.
    const upscaler = late.nodes.find((node) => node.node.id === "upscaler")!;
    const edge = late.edges.find((candidate) => candidate.from === "upscaler")!;
    expect(edge.path.startsWith(`M ${upscaler.x + upscaler.width / 2} `)).toBe(true);
  });

  it("routes an edge that skips rows around every box, neighbours in its row included", () => {
    // The model's neighbours share its row, and it feeds both the next row and the output.
    const crowded = layoutWorkflowMap([
      box("model", "model", ["base", "out"]),
      box("lora", "loras", ["base"]),
      box("prompt", "prompt", ["base"]),
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
    expect(Math.max(...points.map(([x]) => x))).toBeGreaterThan(
      Math.max(...crowded.nodes.map((node) => node.x + node.width)),
    );
    // It comes in from the top of its target.
    const out = crowded.nodes.find((node) => node.node.id === "out")!;
    const { x: endX, y: endY } = end(skip.path);
    expect(endY).toBeCloseTo(out.y);
    expect(endX).toBeGreaterThan(out.x);
    expect(endX).toBeLessThan(out.x + out.width);
  });

  it("fans edges that share a box out along it, ordered by their other end", () => {
    const fanned = layoutWorkflowMap([
      box("model", "model", ["base"]),
      box("lora", "loras", ["base"]),
      box("prompt", "prompt", ["base"]),
      box("base", "pass", ["out"]),
      box("out", "output", []),
    ]);
    const x = (id: string) => fanned.nodes.find((node) => node.node.id === id)!.x;
    const into = fanned.edges
      .filter((edge) => edge.to === "base")
      .sort((a, b) => x(a.from) - x(b.from))
      .map((edge) => end(edge.path).x);

    // Left to right like their sources, so the three edges never cross on the way in.
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
