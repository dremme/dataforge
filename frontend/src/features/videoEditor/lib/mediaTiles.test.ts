import { describe, expect, it } from "vitest";
import { makeClip } from "@/test/videoProject";
import { clipTiles, MAX_TILES, tileSeconds } from "./mediaTiles";

const LEVEL = { tilePx: 512, minSeconds: 1 / 32 };
const EVERYWHERE = { start: 0, end: Infinity };

describe("tileSeconds", () => {
  it("picks the power of two that makes a tile about its width, finer as the zoom grows", () => {
    expect(tileSeconds(64, 1, LEVEL)).toBe(8);
    expect(tileSeconds(512, 1, LEVEL)).toBe(1);
    // Twice as fast, a timeline second holds two source seconds.
    expect(tileSeconds(512, 2, LEVEL)).toBe(2);
    expect(tileSeconds(1e6, 1, LEVEL)).toBe(1 / 32);
  });
});

describe("clipTiles", () => {
  it("cuts the take on fixed source bounds and places the tiles under the clip", () => {
    // A take from 3 s of the source, at 10 s on the timeline, for 4 s.
    const clip = makeClip("c", "v1", 10, 4, { kind: "video", source_in: 3 });

    const tiles = clipTiles(clip, EVERYWHERE, 128, 128, LEVEL);

    // 4 s tiles: 0-4 starts three seconds before the take, 4-8 reaches past its end at 7 s.
    expect(tiles.map((tile) => [tile.start, tile.end])).toEqual([
      [0, 4],
      [4, 8],
    ]);
    expect(tiles[0].left).toBe(-384);
    expect(tiles[1]).toMatchObject({ left: 128, width: 512 });
  });

  it("asks only for tiles in view, and none past the end of the file", () => {
    const clip = makeClip("c", "a1", 0, 100, { kind: "audio" });

    const tiles = clipTiles(clip, { start: 40, end: 42 }, 512, 512, LEVEL);
    expect(tiles.map((tile) => tile.start)).toEqual([40, 41]);

    const ending = clipTiles(clip, { start: 0, end: 3 }, 512, 512, LEVEL, 2.5);
    expect(ending.map((tile) => [tile.start, tile.end])).toEqual([
      [0, 1],
      [1, 2],
      [2, 2.5],
    ]);
    expect(clipTiles(clip, { start: 200, end: 300 }, 512, 512, LEVEL)).toEqual([]);
  });

  it("keeps a lagging level while the zoom moves, and caps the tiles of one clip", () => {
    const clip = makeClip("c", "a1", 0, 1000, { kind: "audio" });

    const zooming = clipTiles(clip, { start: 0, end: 4 }, 1024, 512, LEVEL);
    expect(zooming[1]).toMatchObject({ start: 1, left: 1024, width: 1024 });

    expect(clipTiles(clip, EVERYWHERE, 51200, 51200, LEVEL)).toHaveLength(MAX_TILES);
  });
});
