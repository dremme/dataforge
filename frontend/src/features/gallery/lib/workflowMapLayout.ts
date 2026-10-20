import type { ComfyMapNode } from "@/shared/types";

// Layout runs in viewBox units, one per CSS pixel at the width it is given, so no box is
// measured: the SVG scales to its column, and the boxes over it are placed in percentages of the
// same box. Below the minimum the whole drawing scales down instead of crowding its columns.
const MIN_WIDTH = 480;
const PAD = 8;
const NODE_HEIGHT = 30;
const LAYER_GAP = 36;
const MAX_NODE_WIDTH = 240;
/** Room beside each column for the lanes of connections that skip rows. */
const COLUMN_WIRE_ROOM = 32;
/** How far a lane keeps from boxes. */
const LANE_CLEARANCE = 6;
/**
 * Spacings a lane may keep from its neighbours, each with the detour it is worth: a squeezed
 * lane in a nearby gutter reads better than one that crosses a column to reach an empty one.
 */
const LANE_SPACINGS = [
  { gap: 6, penalty: 0 },
  { gap: 3, penalty: 60 },
  { gap: 0, penalty: 600 },
];
/** Lanes lean towards their target, so a lane that leaves early rarely crosses later ones. */
const TARGET_PULL = 1.05;
/** The detour, in units, a lane takes to avoid crossing one other wire. */
const CROSSING_COST = 80;
/** Times every lane is placed; later rounds see the lanes placed after it. */
const LANE_ROUNDS = 3;

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

/** The vertical track a source's row-skipping connections share, over the rows they pass. */
interface Lane {
  first: number;
  last: number;
  x: number;
}

/** Where a wire turns sideways: in the gap above row ``gap``, from ``x1`` across to ``x2``. */
interface Turn {
  gap: number;
  x1: number;
  x2: number;
  from: string;
  to: string;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Passes read down the centre, each preceded by its new preparations in semantic columns:
 * models and LoRAs, CLIP and prompts, then VAE and media. Every box has the same width, so the
 * gutters between columns stay clear from top to bottom. A connection to the next row is one
 * curve; one that skips rows drops into a straight lane in a gutter, shared by every connection
 * from that source, and leaves it above its target.
 */
export function layoutWorkflowMap(map: ComfyMapNode[], available = MIN_WIDTH): WorkflowMapLayout {
  const width = Math.max(MIN_WIDTH, Math.floor(available));
  if (map.length === 0) return { width, height: 2 * PAD, nodes: [], edges: [] };
  const rowOf = assignRows(map);
  const row = (id: string) => rowOf.get(id)!;
  const rowCount = Math.max(0, ...rowOf.values()) + 1;
  const top = (index: number) => PAD + index * (NODE_HEIGHT + LAYER_GAP);

  const columns = [...new Set(map.flatMap((node) => columnOf(node) ?? []))].sort();
  const columnWidth = (width - 2 * PAD) / Math.max(1, columns.length);
  const boxWidth = Math.min(MAX_NODE_WIDTH, columnWidth - COLUMN_WIRE_ROOM);
  const nodes: PlacedMapNode[] = map.map((node) => {
    const column = columnOf(node);
    const middle =
      column === undefined ? width / 2 : PAD + (columns.indexOf(column) + 0.5) * columnWidth;
    return {
      node,
      ran: node.status === "ran",
      x: middle - boxWidth / 2,
      y: top(row(node.id)),
      width: boxWidth,
      height: NODE_HEIGHT,
    };
  });
  const placed = new Map(nodes.map((box) => [box.node.id, box]));
  const centre = (id: string) => placed.get(id)!.x + boxWidth / 2;
  const skips = (from: string, to: string) => row(to) > row(from) + 1;

  // Each lane takes the clear spot nearest the straight run from its source to its targets,
  // keeping clear of boxes and of the lanes beside it, and crossing as few other wires as it can.
  // Lanes that start higher are placed first, then each is placed again among all the others.
  const direct: Turn[] = map.flatMap((node) =>
    node.feeds
      .filter((to) => !skips(node.id, to))
      .map((to) => ({ gap: row(to), x1: centre(node.id), x2: centre(to), from: node.id, to })),
  );
  const between = (x: number, a: number, b: number) => Math.min(a, b) < x && x < Math.max(a, b);
  const covers = (lane: Lane, gap: number) => lane.first < gap && gap <= lane.last;
  const lanes = new Map<string, Lane>();
  const laneTurns = new Map<string, Turn[]>();
  const crossings = (id: string, lane: Lane, own: Turn[]) => {
    const others = [...lanes].filter(([other]) => other !== id).map(([, other]) => other);
    const turns = [
      ...direct,
      ...[...laneTurns].filter(([other]) => other !== id).flatMap(([, list]) => list),
    ];
    const meeting = (mine: Turn, turn: Turn) =>
      turn.gap === mine.gap &&
      turn.from !== mine.from &&
      turn.to !== mine.to &&
      (turn.x1 - mine.x1) * (turn.x2 - mine.x2) < 0;
    return (
      own.filter((turn) =>
        others.some((other) => covers(other, turn.gap) && between(other.x, turn.x1, turn.x2)),
      ).length +
      turns.filter((turn) => covers(lane, turn.gap) && between(lane.x, turn.x1, turn.x2)).length +
      own.reduce((count, mine) => count + turns.filter((turn) => meeting(mine, turn)).length, 0)
    );
  };
  const place = (node: ComfyMapNode) => {
    const far = node.feeds.filter((to) => skips(node.id, to));
    const toward = far.reduce((sum, to) => sum + centre(to), 0) / far.length;
    const first = row(node.id) + 1;
    const last = Math.max(...far.map(row)) - 1;
    const boxes = nodes
      .filter((box) => row(box.node.id) >= first && row(box.node.id) <= last)
      .map((box): [number, number] => [box.x - LANE_CLEARANCE, box.x + box.width + LANE_CLEARANCE]);
    // Lanes that meet in one gap would touch there, so they count as neighbours too.
    const neighbours = [...lanes].filter(
      ([id, lane]) => id !== node.id && lane.first <= last + 1 && first <= lane.last + 1,
    );
    const from = centre(node.id);
    const turnsAt = (x: number): Turn[] => [
      { gap: first, x1: from, x2: x, from: node.id, to: "" },
      ...far.map((to) => ({ gap: row(to), x1: x, x2: centre(to), from: node.id, to })),
    ];
    const cost = (x: number) =>
      Math.abs(x - from) +
      TARGET_PULL * Math.abs(x - toward) +
      CROSSING_COST * crossings(node.id, { first, last, x }, turnsAt(x));
    let x = PAD / 2;
    let lowest = Infinity;
    for (const { gap, penalty } of LANE_SPACINGS) {
      const blocked = [
        ...boxes,
        ...neighbours.map(([, lane]): [number, number] => [lane.x - gap, lane.x + gap]),
      ];
      for (const [low, high] of clear(PAD / 2, width - PAD / 2, blocked)) {
        for (const value of [low, high, from, toward]) {
          const candidate = Math.min(high, Math.max(low, value));
          const total = cost(candidate) + penalty;
          if (total < lowest) [x, lowest] = [candidate, total];
        }
      }
    }
    lanes.set(node.id, { first, last, x });
    laneTurns.set(node.id, turnsAt(x));
  };
  const sources = map
    .filter((node) => node.feeds.some((to) => skips(node.id, to)))
    .sort((a, b) => row(a.id) - row(b.id));
  for (let round = 0; round < LANE_ROUNDS; round++) sources.forEach(place);

  // Edges sharing a box fan out along it, ordered by where their other end sits, so they never
  // cross as they meet the box. A source's lane is one port, whichever targets it serves.
  const links = map.flatMap((node) => node.feeds.map((to) => ({ from: node.id, to })));
  const below = (from: string, to: string) =>
    skips(from, to) ? { key: "", x: lanes.get(from)!.x } : { key: to, x: centre(to) };
  const above = (from: string, to: string) => ({
    key: from,
    x: skips(from, to) ? lanes.get(from)!.x : centre(from),
  });
  const port = (id: string, ends: { key: string; x: number }[], key: string) => {
    const keys = [...new Map(ends.map((end) => [end.key, end.x]))]
      .sort(([, a], [, b]) => a - b)
      .map(([end]) => end);
    const box = placed.get(id)!;
    return box.x + (box.width * (keys.indexOf(key) + 1)) / (keys.length + 1);
  };

  const edges = links.map(({ from, to }) => {
    const out = links.filter((link) => link.from === from).map((link) => below(from, link.to));
    const into = links.filter((link) => link.to === to).map((link) => above(link.from, to));
    const start = { x: port(from, out, below(from, to).key), y: top(row(from)) + NODE_HEIGHT };
    const end = { x: port(to, into, from), y: top(row(to)) };
    let path = `M ${start.x} ${start.y}`;
    if (skips(from, to)) {
      const { x, first } = lanes.get(from)!;
      const exit = top(row(to) - 1) + NODE_HEIGHT;
      path += ` ${bend(start, { x, y: top(first) })} L ${x} ${exit} ${bend({ x, y: exit }, end)}`;
    } else {
      path += ` ${bend(start, end)}`;
    }
    return { from, to, ran: placed.get(from)!.ran && placed.get(to)!.ran, path };
  });

  return {
    width,
    height: top(rowCount - 1) + NODE_HEIGHT + PAD,
    nodes,
    edges,
  };
}

/** A curve that leaves and arrives vertically, as a node editor draws its wires. */
function bend(a: Point, b: Point): string {
  const middle = (a.y + b.y) / 2;
  return `C ${a.x} ${middle}, ${b.x} ${middle}, ${b.x} ${b.y}`;
}

/** What remains of ``[low, high]`` once the ``blocked`` spans are taken out. */
function clear(low: number, high: number, blocked: [number, number][]): [number, number][] {
  const free: [number, number][] = [];
  let from = low;
  for (const [start, end] of [...blocked].sort(([a], [b]) => a - b)) {
    if (start > from) free.push([from, Math.min(start, high)]);
    from = Math.max(from, end);
    if (from >= high) break;
  }
  if (from < high) free.push([from, high]);
  return free.filter(([start, end]) => start <= end);
}

/**
 * Each pass gets a preparation section above it. Dependencies assign a preparation to its first
 * pass; within a section, boxes rise from the pass, each placed just above what it feeds, so a
 * model sits over its LoRAs rather than over the next model. Boxes in one column stack.
 */
function assignRows(map: ComfyMapNode[]): Map<string, number> {
  const byId = new Map(map.map((node) => [node.id, node]));
  const order = new Map(map.map((node, index) => [node.id, index]));
  const feeders = new Map<string, string[]>();
  for (const node of map) {
    for (const target of node.feeds) feeders.set(target, [...(feeders.get(target) ?? []), node.id]);
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
    const members = map.filter(
      (node) => columnOf(node) !== undefined && section.get(node.id) === index,
    );
    const inSection = new Set(members.map((node) => node.id));
    // Counted up from the pass: 1 is the row just above it.
    const depth = new Map<string, number>();
    const highest = new Map<number, number>();
    const place = (node: ComfyMapNode) => {
      const column = columnOf(node)!;
      const readers = node.feeds.flatMap((id) => (depth.has(id) ? [depth.get(id)! + 1] : []));
      const placedAt = Math.max(1, (highest.get(column) ?? 0) + 1, ...readers);
      depth.set(node.id, placedAt);
      highest.set(column, placedAt);
    };
    // Depth first from the pass, so each chain stacks together; a box waits for all its readers.
    const climb = (id: string) => {
      const sources = [...(feeders.get(id) ?? [])].sort((a, b) => order.get(b)! - order.get(a)!);
      for (const source of sources) {
        const node = byId.get(source)!;
        if (!inSection.has(source) || depth.has(source)) continue;
        if (node.feeds.some((reader) => inSection.has(reader) && !depth.has(reader))) continue;
        place(node);
        climb(source);
      }
    };
    if (passes[index]) climb(passes[index].id);
    for (const node of [...members].reverse()) {
      if (depth.has(node.id)) continue;
      place(node);
      climb(node.id);
    }
    const height = Math.max(0, ...depth.values());
    for (const [id, placedAt] of depth) rowOf.set(id, start + height - placedAt);
    if (passes[index]) {
      rowOf.set(passes[index].id, start + height);
      start += height + 1;
    }
  }
  return rowOf;
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
