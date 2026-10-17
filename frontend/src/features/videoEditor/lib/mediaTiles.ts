/**
 * Which pictures a clip on the timeline asks for. A source is cut into tiles of a power-of-two
 * number of seconds, chosen so a tile is about ``tilePx`` wide at the zoom, and only the tiles in
 * view are fetched. Their bounds are the same whatever the clip's trim or place, so scrolling,
 * trimming and moving reuse the tiles already fetched, and zooming in fetches finer ones.
 */
import { clipEnd, type Clip, type TimeRange } from "./timeline";

export interface MediaTile {
  /** Source seconds the tile covers. */
  start: number;
  end: number;
  /** Pixels from the clip's left edge, and across, at the timeline's zoom. */
  left: number;
  width: number;
}

export interface TileLevel {
  /** Pixels a tile should take; the tile's seconds are the power of two nearest that. */
  tilePx: number;
  /** The finest tile, in seconds; zooming in further only stretches it. */
  minSeconds: number;
}

/** No more than this many tiles are asked for one clip at once. */
export const MAX_TILES = 48;

/** The seconds per tile at a zoom of ``pxPerSecond`` timeline pixels per second. */
export function tileSeconds(pxPerSecond: number, speed: number, level: TileLevel): number {
  const pxPerSourceSecond = pxPerSecond / speed;
  const exponent = Math.round(Math.log2(level.tilePx / Math.max(pxPerSourceSecond, 1e-6)));
  return Math.max(level.minSeconds, 2 ** exponent);
}

/**
 * The tiles of ``clip``'s take inside ``view`` (timeline seconds), placed at ``pxPerSecond``.
 * ``levelPx`` is the zoom the level of detail follows; it may lag the live zoom, so a zoom in
 * progress stretches the tiles it has rather than fetching every level it passes through. Tiles
 * end at ``sourceDuration``, when given.
 */
export function clipTiles(
  clip: Clip,
  view: TimeRange,
  pxPerSecond: number,
  levelPx: number,
  level: TileLevel,
  sourceDuration: number | null = null,
): MediaTile[] {
  const from = Math.max(clip.start, view.start);
  const to = Math.min(clipEnd(clip), view.end);
  if (to <= from) return [];
  const span = tileSeconds(levelPx, clip.speed, level);
  const sourceAt = (time: number) => clip.source_in + (time - clip.start) * clip.speed;
  const limit = sourceDuration ?? Infinity;
  const first = Math.max(0, Math.floor(sourceAt(from) / span));
  const last = Math.ceil(Math.min(sourceAt(to), limit) / span);
  const tiles: MediaTile[] = [];
  for (let index = first; index < last && tiles.length < MAX_TILES; index += 1) {
    const start = index * span;
    const end = Math.min((index + 1) * span, limit);
    if (end <= start) break;
    tiles.push({
      start,
      end,
      left: ((start - clip.source_in) / clip.speed) * pxPerSecond,
      width: ((end - start) / clip.speed) * pxPerSecond,
    });
  }
  return tiles;
}
