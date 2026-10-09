import type { ComfyMapNode } from "@/shared/types";

// Layout runs in viewBox units, one per CSS pixel at the width it is given, so no box is
// measured: the SVG scales to its column, and the boxes over it are placed in percentages of the
// same box. Below the minimum the whole drawing scales down instead of crowding its rows.
const MIN_WIDTH = 480;
const PAD = 8;
const NODE_HEIGHT = 30;
const LAYER_GAP = 28;
const COLUMN_GAP = 8;
/** The clearance a wire keeps from its neighbours in a row. */
const WIRE_GAP = 6;
const MAX_NODE_WIDTH = 240;
const ORDER_SWEEPS = 12;
const SWAP_PASSES = 4;
const PLACE_ROUNDS = 8;
/** What one pair of boxes out of kind order costs, in viewBox units of sideways wire. */
const MIXED_KIND_COST = 60;
/** Crossings outweigh any amount of sideways wire. */
const CROSSING_COST = 10_000;

/** Within a row, kinds read left to right in this order unless the wires say otherwise. */
const KIND_RANK = {
  model: 0,
  loras: 1,
  vae: 2,
  input: 3,
  positive: 4,
  negative: 5,
  pass: 6,
  output: 7,
} as const;

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

/** A box, or a wire: where an edge that skips rows passes through one of them. */
interface Slot {
  id: string;
  row: number;
  box: boolean;
  width: number;
  x: number;
}

/**
 * A layered drawing: boxes in rows by their longest chain of upstream boxes, the output last.
 * A source such as a model or prompt sits just above the first box it feeds, so rows stay
 * short. An edge that skips rows passes through each row between as a wire with a slot of its
 * own, so it runs between boxes, never through one; a source's skipping edges share its wire.
 *
 * Each row is ordered to cut crossings (barycentre sweeps, then neighbour swaps that also
 * shorten the wires), and every slot is pulled over the slots it links to, so edges run as
 * straight as the row's room allows.
 */
export function layoutWorkflowMap(map: ComfyMapNode[], available = MIN_WIDTH): WorkflowMapLayout {
  const width = Math.max(MIN_WIDTH, Math.floor(available));
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

  const rank = new Map(
    map.map((node) => [
      node.id,
      KIND_RANK[node.kind === "prompt" ? (node.role ?? "positive") : node.kind],
    ]),
  );
  const order = new Map(map.map((node, index) => [node.id, index]));
  const ownerOf = (id: string) => id.split("@")[0];
  // The map arrives earliest first and kind-ordered; a wire starts beside its source.
  const rows: string[][] = Array.from({ length: rowCount }, () => []);
  for (const placed of slots.values()) rows[placed.row].push(placed.id);
  for (const row of rows) row.sort((a, b) => order.get(ownerOf(a))! - order.get(ownerOf(b))!);

  const get = (id: string) => slots.get(id)!;
  const centre = (placed: Slot) => placed.x + placed.width / 2;
  const gap = (a: Slot, b: Slot) => (a.box && b.box ? COLUMN_GAP : WIRE_GAP);
  const contentWidth = width - 2 * PAD;

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
    }
    const count = crossings();
    if (count < fewest) {
      fewest = count;
      best = rows.map((ids) => [...ids]);
    }
  }
  best.forEach((ids, row) => (rows[row] = ids));

  // A box whose only link down is a box whose only link up is it, such as a model over its
  // LoRAs: the pair stacks in one column when the row has room.
  const paired = (a: Slot, b: Slot) =>
    a.box &&
    b.box &&
    down.get(a.id)?.size === 1 &&
    down.get(a.id)!.has(b.id) &&
    up.get(b.id)?.size === 1;
  // How hard ``other`` pulls ``placed``: wires straighten, pairs stack, a wire barely moves a box.
  const pull = (placed: Slot, other: Slot) => {
    if (!placed.box) return other.box ? 2 : 8;
    if (!other.box) return 0.25;
    return paired(placed, other) || paired(other, placed) ? 8 : 1;
  };

  const arrange = () => {
    for (const row of rows) {
      const members = row.map(get);
      const boxes = members.filter((placed) => placed.box);
      const wires = members.length - boxes.length;
      const room = contentWidth - (boxes.length - 1) * COLUMN_GAP - wires * 2 * WIRE_GAP;
      const boxWidth = Math.min(MAX_NODE_WIDTH, room / Math.max(1, boxes.length));
      for (const placed of boxes) placed.width = boxWidth;
      // Packed and centred, before the pulls below move it.
      const span = members.reduce((t, s, i) => t + s.width + (i ? gap(members[i - 1], s) : 0), 0);
      let x = PAD + (contentWidth - span) / 2;
      members.forEach((placed, index) => {
        if (index) x += gap(members[index - 1], placed);
        placed.x = x;
        x += placed.width;
      });
    }
    for (let round = 0; round < PLACE_ROUNDS; round++) {
      const indices = [...rows.keys()];
      for (const row of round % 2 === 0 ? indices : indices.reverse()) {
        const members = rows[row].map(get);
        const wanted = members.map((placed) => {
          const near = [...(up.get(placed.id) ?? []), ...(down.get(placed.id) ?? [])].map(get);
          if (!near.length) return placed.x;
          const weights = near.map((other) => pull(placed, other));
          const total = weights.reduce((a, b) => a + b, 0);
          const mean = near.reduce((t, other, i) => t + centre(other) * weights[i], 0) / total;
          return mean - placed.width / 2;
        });
        placeRow(members, wanted, gap, PAD, PAD + contentWidth);
      }
    }
  };

  // Then swap neighbours while that cuts crossings, or keeps them and shortens the wires. Kinds
  // out of their usual order cost a little, so a row stays readable when little is at stake.
  const cost = () => {
    arrange();
    let sideways = 0;
    for (const [from, targets] of down) {
      for (const to of targets) sideways += Math.abs(centre(get(from)) - centre(get(to)));
    }
    let mixed = 0;
    for (const row of rows) {
      const ranks = row.filter((id) => get(id).box).map((id) => rank.get(id)!);
      ranks.forEach((a, i) => (mixed += ranks.slice(i + 1).filter((b) => b < a).length));
    }
    return crossings() * CROSSING_COST + sideways + mixed * MIXED_KIND_COST;
  };
  let current = cost();
  for (let pass = 0; pass < SWAP_PASSES; pass++) {
    let improved = false;
    for (const row of rows) {
      for (let i = 0; i + 1 < row.length; i++) {
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
    const path = chain
      .slice(1)
      .map((id, step) => {
        const source = get(chain[step]);
        const x1 = portX(source.id, id, down);
        const y1 = top(source.row) + NODE_HEIGHT;
        const x2 = portX(id, source.id, up);
        const y2 = top(source.row + 1);
        const middle = (y1 + y2) / 2;
        return `${step ? "L" : "M"} ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}`;
      })
      .join(" ");
    return { from, to, ran: ran.get(from)! && ran.get(to)!, path };
  });

  return { width, height: top(rowCount - 1) + NODE_HEIGHT + PAD, nodes, edges };
}

function slot(id: string, row: number, box: boolean): Slot {
  return { id, row, box, width: 0, x: 0 };
}

/**
 * Each box's row: one below the lowest box it reads, except that a source sits just above the
 * first box it feeds, and the output always closes the map, even when nothing reached it.
 */
function assignRows(map: ComfyMapNode[]): Map<string, number> {
  const readers = new Map<string, string[]>();
  for (const node of map) {
    for (const target of node.feeds) readers.set(target, [...(readers.get(target) ?? []), node.id]);
  }
  // The map arrives earliest first, so every box a node reads already has its layer.
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
  const last = Math.max(...map.filter((n) => n.kind !== "output").map((n) => layer.get(n.id)!));
  for (const node of map) {
    if (node.kind === "output") layer.set(node.id, Math.max(layer.get(node.id)!, last + 1));
  }
  const used = [...new Set(layer.values())].sort((a, b) => a - b);
  return new Map(map.map((node) => [node.id, used.indexOf(layer.get(node.id)!)]));
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
