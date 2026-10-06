import type { ComfyMapNode } from "@/shared/types";

// Layout runs in viewBox units, so nothing is measured: the SVG scales to its column, and the
// boxes over it are placed in percentages of the same box.
const WIDTH = 480;
const PAD = 8;
const NODE_HEIGHT = 30;
const LAYER_GAP = 28;
const COLUMN_GAP = 8;
const MAX_NODE_WIDTH = 240;
const LANE_STEP = 7;
const LANE_MARGIN = 7;
const CORNER_RADIUS = 5;
const LANE_STAGGER = 2.5;

export interface PlacedMapNode {
  node: ComfyMapNode;
  ran: boolean;
  x: number;
  y: number;
  /** Rows size their own boxes, so one crowded row does not narrow every other. */
  width: number;
  height: number;
}

export interface MapEdge {
  from: string;
  to: string;
  path: string;
  ran: boolean;
}

export interface WorkflowMapLayout {
  width: number;
  height: number;
  nodes: PlacedMapNode[];
  edges: MapEdge[];
}

/**
 * Boxes in rows by their longest chain of upstream boxes, the output last. A source such as a
 * model or prompt sits just above the first box it feeds rather than at the top, so rows stay
 * short. An edge to the next row runs straight down; one that skips rows bows out through a
 * lane on the right, one lane per source, so it never crosses the boxes in between.
 */
export function layoutWorkflowMap(map: ComfyMapNode[]): WorkflowMapLayout {
  const readers = new Map<string, string[]>();
  for (const node of map) {
    for (const target of node.feeds) readers.set(target, [...(readers.get(target) ?? []), node.id]);
  }
  // The map arrives earliest first, so every box a node reads already has its row.
  const layer = new Map<string, number>();
  for (const node of map) {
    const above = (readers.get(node.id) ?? []).map((id) => layer.get(id) ?? 0);
    layer.set(node.id, above.length > 0 ? Math.max(...above) + 1 : 0);
  }
  for (const node of map) {
    if (!readers.has(node.id) && node.feeds.length > 0) {
      layer.set(node.id, Math.min(...node.feeds.map((id) => layer.get(id)!)) - 1);
    }
  }
  const used = [...new Set(layer.values())].sort((a, b) => a - b);
  const rowOf = new Map(map.map((node) => [node.id, used.indexOf(layer.get(node.id)!)]));
  const rows: ComfyMapNode[][] = used.map(() => []);
  for (const node of map) rows[rowOf.get(node.id)!].push(node);

  const links = map.flatMap((node) => node.feeds.map((to) => ({ from: node.id, to })));
  const skips = (from: string, to: string) => rowOf.get(to)! - rowOf.get(from)! > 1;
  const lanes = [
    ...new Set(links.filter(({ from, to }) => skips(from, to)).map(({ from }) => from)),
  ];
  const laneSpace = lanes.length > 0 ? lanes.length * LANE_STEP + LANE_MARGIN : 0;
  const contentWidth = WIDTH - 2 * PAD - laneSpace;

  const nodes: PlacedMapNode[] = rows.flatMap((row, rowIndex) => {
    const width = Math.min(
      MAX_NODE_WIDTH,
      (contentWidth - (row.length - 1) * COLUMN_GAP) / row.length,
    );
    const rowWidth = row.length * width + (row.length - 1) * COLUMN_GAP;
    const left = PAD + (contentWidth - rowWidth) / 2;
    return row.map((node, column) => ({
      node,
      ran: node.status === "ran",
      x: left + column * (width + COLUMN_GAP),
      y: PAD + rowIndex * (NODE_HEIGHT + LAYER_GAP),
      width,
      height: NODE_HEIGHT,
    }));
  });

  const byId = new Map(nodes.map((placed) => [placed.node.id, placed]));
  const rightEdge = PAD + contentWidth;
  const laneX = (from: string) => rightEdge + LANE_MARGIN + lanes.indexOf(from) * LANE_STEP;
  // Where the far end of an edge sits across the map; a lane comes in from the far right.
  const reach = (from: string, to: string, far: string) =>
    skips(from, to) ? laneX(from) : byId.get(far)!.x + byId.get(far)!.width / 2;
  const exits = ports(links, "from", (link) => reach(link.from, link.to, link.to));
  const entries = ports(links, "to", (link) => reach(link.from, link.to, link.from));
  const portX = (id: string, slot: number, count: number) => {
    const placed = byId.get(id)!;
    return placed.x + (placed.width * (slot + 1)) / (count + 1);
  };

  const edges = links.map((link) => {
    const { from, to } = link;
    const source = byId.get(from)!;
    const target = byId.get(to)!;
    const ran = source.ran && target.ran;
    const [exitSlot, exitCount] = exits.get(link)!;
    const [entrySlot, entryCount] = entries.get(link)!;
    const x1 = portX(from, exitSlot, exitCount);
    const y1 = source.y + NODE_HEIGHT;
    const x2 = portX(to, entrySlot, entryCount);
    const y2 = target.y;
    if (!skips(from, to)) {
      const middle = (y1 + y2) / 2;
      return {
        from,
        to,
        ran,
        path: `M ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}`,
      };
    }
    // Down into the gap below the source's row, out to the lane, down to the gap above the
    // target's row and in from the top: the gaps hold no boxes, so nothing is crossed. Lanes
    // sharing a gap run at staggered heights so their horizontal legs stay apart.
    const stagger = ((lanes.indexOf(from) % 3) - 1) * LANE_STAGGER;
    const below = y1 + LAYER_GAP / 2 + stagger;
    const above = y2 - LAYER_GAP / 2 + stagger;
    return {
      from,
      to,
      ran,
      path: roundedPath([
        [x1, y1],
        [x1, below],
        [laneX(from), below],
        [laneX(from), above],
        [x2, above],
        [x2, y2],
      ]),
    };
  });

  return {
    width: WIDTH,
    height: 2 * PAD + rows.length * NODE_HEIGHT + (rows.length - 1) * LAYER_GAP,
    nodes,
    edges,
  };
}

/**
 * Each edge's slot among the edges sharing its end at one box, ordered by where their other end
 * sits, so edges fan out along the box instead of crossing as they meet it.
 */
function ports(
  links: { from: string; to: string }[],
  side: "from" | "to",
  across: (link: { from: string; to: string }) => number,
): Map<{ from: string; to: string }, [number, number]> {
  const slots = new Map<{ from: string; to: string }, [number, number]>();
  const byBox = new Map<string, { from: string; to: string }[]>();
  for (const link of links) byBox.set(link[side], [...(byBox.get(link[side]) ?? []), link]);
  for (const shared of byBox.values()) {
    const ordered = [...shared].sort((a, b) => across(a) - across(b));
    ordered.forEach((link, slot) => slots.set(link, [slot, ordered.length]));
  }
  return slots;
}

/** A polyline through ``points`` with its corners rounded off. */
function roundedPath(points: [number, number][]): string {
  const [first, ...rest] = points;
  let path = `M ${first[0]} ${first[1]}`;
  rest.forEach(([x, y], index) => {
    const next = rest[index + 1];
    if (!next) {
      path += ` L ${x} ${y}`;
      return;
    }
    const [px, py] = index === 0 ? first : rest[index - 1];
    // No wider than half of either leg, so short legs never overshoot.
    const radius = Math.min(
      CORNER_RADIUS,
      Math.hypot(x - px, y - py) / 2,
      Math.hypot(next[0] - x, next[1] - y) / 2,
    );
    const towards = (fromX: number, fromY: number) => {
      const length = Math.hypot(fromX - x, fromY - y) || 1;
      return [x + ((fromX - x) / length) * radius, y + ((fromY - y) / length) * radius];
    };
    const [ax, ay] = towards(px, py);
    const [bx, by] = towards(next[0], next[1]);
    path += ` L ${ax} ${ay} Q ${x} ${y} ${bx} ${by}`;
  });
  return path;
}

/** How much of a file name's end stays visible when the middle has to give way. */
const KEPT_TAIL = 5;

/**
 * A label as a head that may shrink behind an ellipsis and a tail that always shows. File names
 * keep their end (``…_High``, ``…_v2``), which is what tells them apart; CSS does the cutting.
 */
export function splitLabel(label: string, keepEnd: boolean): { head: string; tail: string } {
  if (!keepEnd || label.length <= KEPT_TAIL * 2) return { head: label, tail: "" };
  return { head: label.slice(0, -KEPT_TAIL), tail: label.slice(-KEPT_TAIL) };
}
