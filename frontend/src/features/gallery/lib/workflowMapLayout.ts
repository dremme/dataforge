import type { ComfyMapNode } from "@/shared/types";

// Layout runs in viewBox units, one per CSS pixel at the width it is given, so no box is
// measured: the SVG scales to its column, and the boxes over it are placed in percentages of the
// same box. Below the minimum the whole drawing scales down instead of crowding its columns.
const MIN_WIDTH = 480;
const PAD = 8;
const NODE_HEIGHT = 30;
const LAYER_GAP = 36;
/** Preferred clearance between wires; busy gutters divide their available room. */
const WIRE_GAP = 6;
const MAX_NODE_WIDTH = 240;
const ORDER_SWEEPS = 12;
const SWAP_PASSES = 4;
const PLACE_ROUNDS = 8;
/** Room beside each preparation column for connections shared by later passes. */
const COLUMN_WIRE_ROOM = 24;
/** Crossings outweigh any amount of sideways wire. */
const CROSSING_COST = 10_000;

/** Related preparations share a column, with unused columns omitted. */
const KIND_COLUMN = {
  model: 0,
  loras: 0,
  clip: 1,
  prompt: 1,
  vae: 2,
  input: 2,
} as const;

function columnOf(node: ComfyMapNode): number | undefined {
  return node.kind === "pass" || node.kind === "output" ? undefined : KIND_COLUMN[node.kind];
}

export interface PlacedMapNode {
  node: ComfyMapNode;
  ran: boolean;
  x: number;
  y: number;
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

/** A box, or a wire: where an edge that skips rows passes through one of them. */
interface Slot {
  id: string;
  row: number;
  box: boolean;
  width: number;
  x: number;
}

/**
 * Passes read down the centre, each preceded by its new preparations in semantic columns:
 * models and LoRAs, CLIP and prompts, then VAE and media. Crowded columns grow vertically.
 * Shared preparations appear once, before their first consumer. Long connections reserve
 * wire slots between boxes; crossing reduction can reorder wires, but not semantic columns.
 */
export function layoutWorkflowMap(map: ComfyMapNode[], available = MIN_WIDTH): WorkflowMapLayout {
  const width = Math.max(MIN_WIDTH, Math.floor(available));
  if (map.length === 0) return { width, height: 2 * PAD, nodes: [], edges: [] };
  const rowOf = assignRows(map);
  const rowCount = Math.max(0, ...rowOf.values()) + 1;

  const slots = new Map<string, Slot>(
    map.map((node) => [node.id, slot(node.id, rowOf.get(node.id)!, true)]),
  );
  const up = new Map<string, Set<string>>();
  const down = new Map<string, Set<string>>();
  const link = (from: string, to: string) => {
    down.set(from, (down.get(from) ?? new Set()).add(to));
    up.set(to, (up.get(to) ?? new Set()).add(from));
  };
  const links = map.flatMap((node) => node.feeds.map((to) => ({ from: node.id, to })));
  const chains = links.map(({ from, to }) => {
    const chain = [from];
    for (let row = rowOf.get(from)! + 1; row < rowOf.get(to)!; row++) {
      const id = `${from}@${row}`;
      if (!slots.has(id)) slots.set(id, slot(id, row, false));
      chain.push(id);
    }
    chain.push(to);
    chain.slice(1).forEach((id, index) => link(chain[index], id));
    return chain;
  });

  const columns = [...new Set(map.flatMap((node) => columnOf(node) ?? []))].sort();
  const column = new Map(map.map((node) => [node.id, columnOf(node)]));
  const order = new Map(map.map((node, index) => [node.id, index]));
  const owner = new Map(map.map((node) => [node.id, node.id]));
  for (const chain of chains) for (const id of chain.slice(1, -1)) owner.set(id, chain[0]);
  const columnRank = (id: string) => column.get(owner.get(id)!) ?? 1;
  const rows: string[][] = Array.from({ length: rowCount }, () => []);
  for (const placed of slots.values()) rows[placed.row].push(placed.id);
  for (const row of rows) {
    row.sort(
      (a, b) =>
        columnRank(a) - columnRank(b) || order.get(owner.get(a)!)! - order.get(owner.get(b)!)!,
    );
  }

  const get = (id: string) => slots.get(id)!;
  const centre = (placed: Slot) => placed.x + placed.width / 2;
  const contentWidth = width - 2 * PAD;
  const columnWidth = contentWidth / Math.max(1, columns.length);
  const wantedX = (placed: Slot) => {
    const group = column.get(placed.id);
    const middle =
      group === undefined ? width / 2 : PAD + (columns.indexOf(group) + 0.5) * columnWidth;
    return middle - placed.width / 2;
  };
  const keepColumns = (row: string[]) => {
    const boxes = row.filter((id) => get(id).box).sort((a, b) => columnRank(a) - columnRank(b));
    let index = 0;
    return row.map((id) => (get(id).box ? boxes[index++] : id));
  };

  const crossings = () => {
    const position = new Map(rows.flatMap((row) => row.map((id, index) => [id, index])));
    let count = 0;
    for (const row of rows) {
      const spans = row.flatMap((from) =>
        [...(down.get(from) ?? [])].map((to) => [position.get(from)!, position.get(to)!]),
      );
      spans.forEach(([a1, a2], i) => {
        for (const [b1, b2] of spans.slice(i + 1)) if ((a1 - b1) * (a2 - b2) < 0) count++;
      });
    }
    return count;
  };

  // Barycentre sweeps, down then up: each slot moves to the mean position of its neighbours on
  // the side just swept. The best order seen is kept.
  let best = rows.map((row) => [...row]);
  let fewest = crossings();
  for (let sweep = 0; sweep < ORDER_SWEEPS && fewest > 0; sweep++) {
    const downward = sweep % 2 === 0;
    const sides = downward ? up : down;
    const indices = [...rows.keys()];
    for (const row of downward ? indices.slice(1) : indices.reverse().slice(1)) {
      const position = new Map(rows.flatMap((ids) => ids.map((id, index) => [id, index])));
      const value = new Map(
        rows[row].map((id, index) => {
          const near = [...(sides.get(id) ?? [])].map((other) => position.get(other)!);
          return [id, near.length ? near.reduce((a, b) => a + b, 0) / near.length : index];
        }),
      );
      rows[row].sort((a, b) => value.get(a)! - value.get(b)!);
      rows[row] = keepColumns(rows[row]);
    }
    const count = crossings();
    if (count < fewest) {
      fewest = count;
      best = rows.map((ids) => [...ids]);
    }
  }
  best.forEach((ids, row) => (rows[row] = ids));

  const arrange = () => {
    for (const placed of slots.values()) {
      if (!placed.box) continue;
      placed.width = Math.min(
        MAX_NODE_WIDTH,
        column.get(placed.id) === undefined ? MAX_NODE_WIDTH : columnWidth - COLUMN_WIRE_ROOM,
      );
      placed.x = wantedX(placed);
    }
    const placeWires = (row: string[], wanted?: (placed: Slot) => number) => {
      let low = PAD;
      let wires: Slot[] = [];
      const fill = (high: number) => {
        if (!wires.length) return;
        const gap = Math.min(WIRE_GAP, (high - low) / (wires.length + 1));
        const positions = wires.map(
          (placed, i) => wanted?.(placed) ?? low + ((high - low) * (i + 1)) / (wires.length + 1),
        );
        placeRow(wires, positions, () => gap, low + gap, high - gap);
        wires = [];
      };
      for (const id of row) {
        const placed = get(id);
        if (placed.box) {
          fill(placed.x);
          low = placed.x + placed.width;
        } else wires.push(placed);
      }
      fill(width - PAD);
    };
    for (const row of rows) placeWires(row);
    for (let round = 0; round < PLACE_ROUNDS; round++) {
      const indices = [...rows.keys()];
      for (const row of round % 2 === 0 ? indices : indices.reverse()) {
        placeWires(rows[row], (placed) => {
          const near = [...(up.get(placed.id) ?? []), ...(down.get(placed.id) ?? [])].map(get);
          if (!near.length) return placed.x;
          const weights = near.map((other) => (other.box ? 2 : 8));
          const total = weights.reduce((a, b) => a + b, 0);
          const mean = near.reduce((t, other, i) => t + centre(other) * weights[i], 0) / total;
          return mean - placed.width / 2;
        });
      }
    }
  };

  // Swap wire slots to reduce crossings while keeping boxes in their semantic columns.
  const cost = () => {
    arrange();
    let sideways = 0;
    for (const [from, targets] of down) {
      for (const to of targets) sideways += Math.abs(centre(get(from)) - centre(get(to)));
    }
    return crossings() * CROSSING_COST + sideways;
  };
  let current = cost();
  for (let pass = 0; pass < SWAP_PASSES; pass++) {
    let improved = false;
    for (const row of rows) {
      for (let i = 0; i + 1 < row.length; i++) {
        if (get(row[i]).box && get(row[i + 1]).box) continue;
        [row[i], row[i + 1]] = [row[i + 1], row[i]];
        const next = cost();
        if (next < current - 0.5) {
          current = next;
          improved = true;
        } else {
          [row[i], row[i + 1]] = [row[i + 1], row[i]];
        }
      }
    }
    if (!improved) break;
  }
  arrange();

  const top = (row: number) => PAD + row * (NODE_HEIGHT + LAYER_GAP);
  const nodes: PlacedMapNode[] = map.map((node) => {
    const placed = get(node.id);
    return {
      node,
      ran: node.status === "ran",
      x: placed.x,
      y: top(placed.row),
      width: placed.width,
      height: NODE_HEIGHT,
    };
  });
  const ran = new Map(nodes.map((placed) => [placed.node.id, placed.ran]));

  // Edges sharing a box fan out along it, one port per slot at the other end, ordered by where
  // that slot sits, so they never cross as they meet the box. A wire is its own single port.
  const portX = (id: string, other: string, side: Map<string, Set<string>>) => {
    const placed = get(id);
    if (!placed.box) return centre(placed);
    const ends = [...side.get(id)!].sort((a, b) => centre(get(a)) - centre(get(b)));
    return placed.x + (placed.width * (ends.indexOf(other) + 1)) / (ends.length + 1);
  };
  const edges = links.map(({ from, to }, index) => {
    const chain = chains[index];
    const points = [
      { x: portX(from, chain[1], down), y: top(get(from).row) + NODE_HEIGHT },
      ...chain.slice(1, -1).flatMap((id) => [
        { x: centre(get(id)), y: top(get(id).row) },
        { x: centre(get(id)), y: top(get(id).row) + NODE_HEIGHT },
      ]),
      { x: portX(to, chain.at(-2)!, up), y: top(get(to).row) },
    ];
    const path = smoothPath(points, nodes);
    return { from, to, ran: ran.get(from)! && ran.get(to)!, path };
  });

  return {
    width,
    height: top(rowCount - 1) + NODE_HEIGHT + PAD,
    nodes,
    edges,
  };
}

interface Point {
  x: number;
  y: number;
}

/** Merge row detours into the longest clear curves; every join keeps a vertical tangent. */
function smoothPath(points: Point[], nodes: PlacedMapNode[]): string {
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let start = 0; start < points.length - 1;) {
    let end = points.length - 1;
    while (
      end > start + 1 &&
      nodes.some((node) => curveIntersects(points[start], points[end], node))
    ) {
      end--;
    }
    const a = points[start];
    const b = points[end];
    const middle = (a.y + b.y) / 2;
    path += ` C ${a.x} ${middle}, ${b.x} ${middle}, ${b.x} ${b.y}`;
    start = end;
  }
  return path;
}

/** A vertical-tangent cubic is monotone in both axes, so its span over a box's height suffices. */
function curveIntersects(a: Point, b: Point, node: PlacedMapNode): boolean {
  const top = Math.max(a.y, node.y);
  const bottom = Math.min(b.y, node.y + node.height);
  if (bottom <= top) return false;
  const left = Math.min(a.x, b.x);
  const right = Math.max(a.x, b.x);
  if (right <= node.x || left >= node.x + node.width) return false;
  const xAtY = (y: number) => {
    const progress = (y - a.y) / (b.y - a.y);
    let low = 0;
    let high = 1;
    // Invert y(t) for controls at the vertical midpoint; x(t) then gives the box-height span.
    for (let step = 0; step < 24; step++) {
      const t = (low + high) / 2;
      const curveY = t * (1.5 + t * (t - 1.5));
      if (curveY < progress) low = t;
      else high = t;
    }
    const t = (low + high) / 2;
    return a.x + (b.x - a.x) * t * t * (3 - 2 * t);
  };
  const x1 = xAtY(top);
  const x2 = xAtY(bottom);
  return Math.max(x1, x2) > node.x + 0.01 && Math.min(x1, x2) < node.x + node.width - 0.01;
}

function slot(id: string, row: number, box: boolean): Slot {
  return { id, row, box, width: 0, x: 0 };
}

/**
 * Each pass gets a preparation section. Dependencies assign a preparation to its first pass;
 * boxes in the same semantic column stack instead of squeezing into one dependency row.
 */
function assignRows(map: ComfyMapNode[]): Map<string, number> {
  const readers = new Map<string, string[]>();
  for (const node of map) {
    for (const target of node.feeds) readers.set(target, [...(readers.get(target) ?? []), node.id]);
  }
  const passes = map.filter((node) => node.kind === "pass" || node.kind === "output");
  const section = new Map(passes.map((node, index) => [node.id, index]));
  // The backend supplies topological order, so consumers already have sections on this walk.
  for (const node of [...map].reverse()) {
    if (!section.has(node.id)) {
      const targets = node.feeds.flatMap((id) => section.get(id) ?? []);
      section.set(node.id, targets.length ? Math.min(...targets) : 0);
    }
  }
  const rowOf = new Map<string, number>();
  let start = 0;
  for (let index = 0; index < Math.max(1, passes.length); index++) {
    const lastInColumn = new Map<number, number>();
    let bottom = start - 1;
    for (const node of map) {
      const column = columnOf(node);
      if (column === undefined || section.get(node.id) !== index) continue;
      const above = (readers.get(node.id) ?? []).map((id) => rowOf.get(id)! + 1);
      const row = Math.max(start, (lastInColumn.get(column) ?? start - 1) + 1, ...above);
      rowOf.set(node.id, row);
      lastInColumn.set(column, row);
      bottom = Math.max(bottom, row);
    }
    if (passes[index]) {
      rowOf.set(passes[index].id, bottom + 1);
      start = bottom + 2;
    }
  }
  return rowOf;
}

/**
 * Left edges for one row's slots, in their order and with their gaps, as close to ``wanted`` as
 * least squares allows: neighbours that collide merge into a block placed at the mean of what
 * its members want. The row is then held inside ``[low, high]``.
 */
function placeRow(
  members: Slot[],
  wanted: number[],
  gap: (a: Slot, b: Slot) => number,
  low: number,
  high: number,
) {
  // Each slot's distance from the row's first left edge when packed tight.
  const offset = members.map(() => 0);
  members.forEach((placed, i) => {
    if (i) offset[i] = offset[i - 1] + members[i - 1].width + gap(members[i - 1], placed);
  });
  const blocks: { start: number; end: number; sum: number; x: number }[] = [];
  members.forEach((_, i) => {
    let block = { start: i, end: i, sum: wanted[i] - offset[i], x: wanted[i] - offset[i] };
    while (blocks.length > 0 && blocks[blocks.length - 1].x > block.x) {
      const previous = blocks.pop()!;
      const sum = previous.sum + block.sum;
      block = {
        start: previous.start,
        end: block.end,
        sum,
        x: sum / (block.end - previous.start + 1),
      };
    }
    blocks.push(block);
  });
  for (const block of blocks) {
    for (let i = block.start; i <= block.end; i++) members[i].x = block.x + offset[i];
  }
  const last = members.length - 1;
  const span = offset[last] + members[last].width;
  members.forEach((placed, i) => (placed.x = Math.max(placed.x, low + offset[i])));
  for (let i = last; i >= 0; i--) members[i].x = Math.min(members[i].x, high - (span - offset[i]));
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
