import { describe, expect, it } from "vitest";
import type { VideoProjectSourceInfo } from "@/shared/types";
import {
  addDissolve,
  addTrack,
  clipEnd,
  deleteClips,
  formatTimecode,
  duplicateClips,
  moveClips,
  moveClipsFlush,
  moveTrack,
  placeSource,
  removeDissolve,
  removeTrack,
  restingAdjust,
  rippleDelete,
  setClipSpeed,
  setDissolveDuration,
  snapBlockDelta,
  snapToFrame,
  splitClips,
  transitionOverlap,
  trimClip,
  trimClipFlush,
  unlinkClips,
  updateTrack,
  type Clip,
  type EditResult,
  type Project,
} from "./timeline";

function clip(
  id: string,
  track: string,
  start: number,
  duration: number,
  extra: Partial<Clip> = {},
): Clip {
  return {
    id,
    track_id: track,
    kind: track.startsWith("a") ? "audio" : "video",
    source_id: "src",
    start,
    duration,
    source_in: 0,
    speed: 1,
    link_id: null,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    crop: null,
    fit: "fit",
    adjust: restingAdjust(),
    gain: 1,
    fade_in: 0,
    fade_out: 0,
    fade_curve: "equal_power",
    title: null,
    keyframes: { x: [], y: [], scale: [], rotation: [], opacity: [], gain: [] },
    ...extra,
  };
}

function project(clips: Clip[]): Project {
  return {
    format_version: 1,
    id: "p",
    name: "Edit",
    revision: 0,
    created_at: "",
    updated_at: "",
    width: 64,
    height: 48,
    frame_rate: 10,
    initial_source_id: "src",
    sources: [
      {
        id: "src",
        name: "clip.mp4",
        kind: "video",
        size: 1,
        modified_us: 1,
        duration: 20,
        width: 64,
        height: 48,
        frame_rate: 10,
        has_audio: true,
      },
    ],
    tracks: [
      {
        id: "v2",
        kind: "video",
        name: "V2",
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
        gain: 1,
        speech: false,
        sync_lock: true,
      },
      {
        id: "v1",
        kind: "video",
        name: "V1",
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
        gain: 1,
        speech: false,
        sync_lock: true,
      },
      {
        id: "a1",
        kind: "audio",
        name: "A1",
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
        gain: 1,
        speech: false,
        sync_lock: true,
      },
      {
        id: "a2",
        kind: "audio",
        name: "A2",
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
        gain: 1,
        speech: false,
        sync_lock: true,
      },
    ],
    clips,
    transitions: [],
    mix: { master_gain: 1, duck_gain: 0.25 },
    markers: [],
    export: {
      filename: "",
      size: "source",
      orientation: null,
      quality: "standard",
      copy_caption: false,
      audio_level: "limit",
    },
  };
}

/** The initial video with its linked sound, then a second linked pair right after it. */
function linkedPair(): Project {
  return project([
    clip("v", "v1", 0, 4, { link_id: "L" }),
    clip("a", "a1", 0, 4, { link_id: "L" }),
    clip("v2nd", "v1", 4, 4, { link_id: "M", source_in: 5 }),
    clip("a2nd", "a1", 4, 4, { link_id: "M", source_in: 5 }),
  ]);
}

function ok(result: EditResult): Project {
  if (result.error !== undefined) throw new Error(result.error);
  return result.project;
}

function byId(p: Project, id: string): Clip {
  const found = p.clips.find((item) => item.id === id);
  if (!found) throw new Error(`no clip ${id}`);
  return found;
}

describe("moving clips", () => {
  it("moves linked sound with its video", () => {
    const moved = ok(moveClips(linkedPair(), { ids: ["v2nd"], delta: 2, draggedId: "v2nd" }));

    expect(byId(moved, "v2nd").start).toBe(6);
    expect(byId(moved, "a2nd").start).toBe(6);
    expect(byId(moved, "v").start).toBe(0);
  });

  it("refuses to cover a neighbour and says where", () => {
    const result = moveClips(linkedPair(), { ids: ["v2nd"], delta: -1, draggedId: "v2nd" });

    expect(result.error).toMatch(/would overlap on V1/);
  });

  it("steps a clip to another track of its kind while its sound keeps its track", () => {
    const moved = ok(
      moveClips(linkedPair(), { ids: ["v2nd"], delta: 0, trackShift: -1, draggedId: "v2nd" }),
    );

    expect(byId(moved, "v2nd").track_id).toBe("v2");
    expect(byId(moved, "a2nd").track_id).toBe("a1");
  });

  it("will not move a clip on a locked track", () => {
    const locked = ok(updateTrack(linkedPair(), "a1", { locked: true }));

    expect(moveClips(locked, { ids: ["v2nd"], delta: 1, draggedId: "v2nd" }).error).toMatch(
      /A1 is locked/,
    );
  });
});

describe("dragging against a neighbour", () => {
  /** Two linked pairs with a gap: 0-4 and 8-12. */
  function gapped(): Project {
    return project([
      clip("v", "v1", 0, 4, { link_id: "L" }),
      clip("a", "a1", 0, 4, { link_id: "L" }),
      clip("w", "v1", 8, 4, { link_id: "M", source_in: 6 }),
      clip("b", "a1", 8, 4, { link_id: "M", source_in: 6 }),
    ]);
  }

  it("stops a moved clip flush against the clip in its way", () => {
    for (const delta of [-5.5, -8]) {
      const moved = ok(moveClipsFlush(gapped(), { ids: ["w"], delta, draggedId: "w" }));

      expect([byId(moved, "w").start, byId(moved, "b").start]).toEqual([4, 4]);
    }
  });

  it("moves freely where nothing is in the way", () => {
    const moved = ok(moveClipsFlush(gapped(), { ids: ["w"], delta: -2, draggedId: "w" }));

    expect(byId(moved, "w").start).toBe(6);
  });

  it("stops a trimmed edge at the neighbour's edge", () => {
    expect(byId(ok(trimClipFlush(gapped(), "w", "start", 3)), "w").start).toBe(4);
    expect(clipEnd(byId(ok(trimClipFlush(gapped(), "v", "end", 9)), "v"))).toBe(8);
  });

  it("still refuses what no nearby spot can fix", () => {
    const locked = ok(updateTrack(gapped(), "a1", { locked: true }));

    expect(moveClipsFlush(locked, { ids: ["w"], delta: -1, draggedId: "w" }).error).toMatch(
      /A1 is locked/,
    );
  });
});

describe("trimming", () => {
  it("trims both linked clips and advances the source in point", () => {
    const trimmed = ok(trimClip(linkedPair(), "v2nd", "start", 5));

    for (const id of ["v2nd", "a2nd"]) {
      expect(byId(trimmed, id).start).toBe(5);
      expect(byId(trimmed, id).duration).toBe(3);
      expect(byId(trimmed, id).source_in).toBe(6);
    }
  });

  it("stops at the start of the source", () => {
    const lone = project([clip("v", "v1", 5, 2, { source_in: 2 })]);

    const trimmed = byId(ok(trimClip(lone, "v", "start", 0)), "v");

    expect([trimmed.start, trimmed.duration, trimmed.source_in]).toEqual([3, 4, 0]);
  });

  it("stops at the end of the source", () => {
    const trimmed = ok(trimClip(linkedPair(), "v2nd", "end", 100));

    expect(clipEnd(byId(trimmed, "v2nd"))).toBe(4 + 15);
  });

  it("lets a still grow in both directions", () => {
    const still = project([clip("s", "v1", 2, 1, { kind: "image" })]);

    expect(byId(ok(trimClip(still, "s", "start", 0)), "s").duration).toBe(3);
    expect(byId(ok(trimClip(still, "s", "end", 50)), "s").duration).toBe(48);
  });
});

describe("splitting", () => {
  it("cuts linked clips at the playhead and links the right halves together", () => {
    const split = ok(splitClips(linkedPair(), 1.5, ["v"]));

    const rights = split.clips.filter((item) => item.start === 1.5);
    expect(rights).toHaveLength(2);
    expect(rights[0].link_id).toBe(rights[1].link_id);
    expect(rights[0].link_id).not.toBe("L");
    expect(rights.every((item) => item.source_in === 1.5)).toBe(true);
    expect(byId(split, "v").duration).toBe(1.5);
  });

  it("cuts everything under the playhead when nothing is chosen", () => {
    const split = ok(splitClips(linkedPair(), 6));

    expect(split.clips).toHaveLength(6);
  });

  it("explains when nothing is under the playhead", () => {
    expect(splitClips(linkedPair(), 30).error).toMatch(/Nothing to split/);
  });
});

describe("deleting", () => {
  it("removes linked partners and leaves the space empty", () => {
    const remaining = ok(deleteClips(linkedPair(), ["v"]));

    expect(remaining.clips.map((item) => item.id)).toEqual(["v2nd", "a2nd"]);
    expect(byId(remaining, "v2nd").start).toBe(4);
  });

  it("deletes only one side once unlinked", () => {
    const unlinked = ok(unlinkClips(linkedPair(), ["v"]));

    const remaining = ok(deleteClips(unlinked, ["v"]));
    expect(remaining.clips.map((item) => item.id)).toContain("a");
  });
});

describe("duplicating", () => {
  it("places copies after the selection with links of their own", () => {
    const base = project([
      clip("v", "v1", 0, 2, { link_id: "L" }),
      clip("a", "a1", 0, 2, { link_id: "L" }),
    ]);

    const result = duplicateClips(base, ["v"]);

    const copies = result.copies ?? [];
    expect(copies).toHaveLength(2);
    const made = ok(result).clips.filter((item) => copies.includes(item.id));
    expect(made.every((item) => item.start === 2)).toBe(true);
    expect(made[0].link_id).toBe(made[1].link_id);
    expect(made[0].link_id).not.toBe("L");
  });
});

describe("ripple delete", () => {
  it("removes the range from every track and closes the gap", () => {
    const rippled = ok(rippleDelete(linkedPair(), { start: 3, end: 5 }));

    expect(byId(rippled, "v").duration).toBe(3);
    expect(byId(rippled, "v2nd").start).toBe(3);
    expect(byId(rippled, "v2nd").duration).toBe(3);
    expect(byId(rippled, "v2nd").source_in).toBe(6);
    expect(byId(rippled, "a2nd").start).toBe(3);
  });

  it("keeps both outer parts of a clip that spans the range", () => {
    const rippled = ok(rippleDelete(project([clip("long", "v1", 0, 10)]), { start: 2, end: 5 }));

    const parts = rippled.clips.sort((a, b) => a.start - b.start);
    expect(parts.map((item) => [item.start, item.duration, item.source_in])).toEqual([
      [0, 2, 0],
      [2, 5, 5],
    ]);
  });

  it("names the locked track it would change", () => {
    const locked = ok(updateTrack(linkedPair(), "a1", { locked: true }));

    expect(rippleDelete(locked, { start: 1, end: 2 }).error).toMatch(/Unlock A1/);
  });

  it("ignores a locked track with nothing after the range", () => {
    const base = project([clip("early", "v2", 0, 1), clip("late", "v1", 5, 2)]);
    const locked = ok(updateTrack(base, "v2", { locked: true }));

    expect(byId(ok(rippleDelete(locked, { start: 2, end: 4 })), "late").start).toBe(3);
  });
});

describe("speed", () => {
  it("retimes linked clips together and keeps the take", () => {
    const fast = ok(
      setClipSpeed(
        project([clip("v", "v1", 0, 4, { link_id: "L" }), clip("a", "a1", 0, 4, { link_id: "L" })]),
        "v",
        2,
      ),
    );

    for (const id of ["v", "a"]) {
      expect(byId(fast, id).duration).toBe(2);
      expect(byId(fast, id).speed).toBe(2);
    }
  });

  it("refuses a slow-down that would run into the next clip", () => {
    expect(setClipSpeed(linkedPair(), "v", 0.5).error).toMatch(/run into the next one/);
  });
});

describe("dissolves", () => {
  it("slides the incoming clip and its sound back over the outgoing one", () => {
    const joined = ok(addDissolve(linkedPair(), "v", 1));

    expect(byId(joined, "v2nd").start).toBe(3);
    expect(byId(joined, "a2nd").start).toBe(3);
    expect(joined.transitions).toHaveLength(1);
    expect(transitionOverlap(joined, joined.transitions[0])).toBe(1);
  });

  it("follows the overlap when its length changes", () => {
    const joined = ok(addDissolve(linkedPair(), "v", 1));

    const longer = ok(setDissolveDuration(joined, joined.transitions[0].id, 2));

    expect(byId(longer, "v2nd").start).toBe(2);
    expect(byId(longer, "a2nd").start).toBe(2);
  });

  it("disappears when the clips are pulled apart", () => {
    const joined = ok(addDissolve(linkedPair(), "v", 1));

    const apart = ok(moveClips(joined, { ids: ["v2nd"], delta: 2, draggedId: "v2nd" }));

    expect(apart.transitions).toHaveLength(0);
  });

  it("can be removed, which brings the clips back end to end", () => {
    const joined = ok(addDissolve(linkedPair(), "v", 1));

    const removed = ok(removeDissolve(joined, joined.transitions[0].id));

    expect(removed.transitions).toHaveLength(0);
    expect(byId(removed, "v2nd").start).toBe(4);
  });
});

describe("placing sources", () => {
  const audio: VideoProjectSourceInfo = {
    path: "/x/music.wav",
    name: "music.wav",
    kind: "audio",
    size: 10,
    modified_us: 2,
    duration: 8,
    has_audio: true,
  };

  it("adds a chosen range of a file on the first free track of its kind", () => {
    const result = placeSource(linkedPair(), { info: audio, start: 0, rangeIn: 2, rangeOut: 5 });

    const placed = byId(ok(result), result.placed?.[0] ?? "");
    expect(placed.track_id).toBe("a2");
    expect([placed.source_in, placed.duration]).toEqual([2, 3]);
  });

  it("refuses a changed file that the project already uses", () => {
    const changed = { ...audio, name: "clip.mp4", kind: "video" as const };

    expect(placeSource(linkedPair(), { info: changed, start: 10 }).error).toMatch(
      /Accept the change/,
    );
  });

  it("explains a drop onto a track of the wrong kind", () => {
    expect(placeSource(linkedPair(), { info: audio, start: 10, trackId: "v1" }).error).toMatch(
      /audio track/,
    );
  });
});

describe("an empty project", () => {
  const video: VideoProjectSourceInfo = {
    path: "/x/trip.mov",
    name: "trip.mov",
    kind: "video",
    size: 10,
    modified_us: 2,
    duration: 8,
    width: 1281,
    height: 720,
    frame_rate: 25,
    has_audio: false,
  };

  function empty(): Project {
    return { ...project([]), sources: [], initial_source_id: null, name: "Untitled project" };
  }

  it("takes its frame, rate and name from the first video placed in it", () => {
    const placed = ok(placeSource(empty(), { info: video, start: 0 }));

    expect([placed.width, placed.height, placed.frame_rate]).toEqual([1280, 720, 25]);
    expect(placed.name).toBe("trip edit");
    expect(placed.initial_source_id).toBe(placed.sources[0].id);
  });

  it("keeps its own settings once it holds other media", () => {
    const still = { ...video, name: "still.png", kind: "image" as const, frame_rate: null };
    const withStill = ok(placeSource(empty(), { info: still, start: 0 }));

    const placed = ok(placeSource(withStill, { info: video, start: 10 }));

    expect([placed.width, placed.frame_rate, placed.name]).toEqual([64, 10, "Untitled project"]);
  });
});

describe("tracks", () => {
  it("adds video tracks on top and keeps groups apart when reordering", () => {
    const added = ok(addTrack(linkedPair(), "video"));

    expect(added.tracks[0].name).toBe("V3");
    expect(moveTrack(added, "v1", 1).error).toMatch(/edge of its group/);
    expect(
      ok(moveTrack(added, "v1", -1))
        .tracks.map((t) => t.id)
        .slice(0, 3),
    ).toEqual([added.tracks[0].id, "v1", "v2"]);
  });

  it("removes only empty tracks", () => {
    expect(removeTrack(linkedPair(), "v1").error).toMatch(/still holds clips/);
    expect(ok(removeTrack(linkedPair(), "v2")).tracks).toHaveLength(3);
  });
});

describe("snapping", () => {
  it("snaps whichever edge of a moving block is closer to a target", () => {
    expect(snapBlockDelta(0, 2, 2.9, [5], 0.2)).toBeCloseTo(3);
    expect(snapBlockDelta(0, 2, 4.95, [5], 0.2)).toBeCloseTo(5);
    expect(snapBlockDelta(0, 2, 1, [5], 0.2)).toBe(1);
  });
});

describe("formatTimecode", () => {
  it("shows hours, minutes, seconds and frames when given a rate", () => {
    expect(formatTimecode(6.8, 30)).toBe("00:00:06:24");
    expect(formatTimecode(3725.48, 25)).toBe("01:02:05:12");
    expect(formatTimecode(65)).toBe("01:05");
  });

  it("reads a time between frames as the nearest frame, as stepping places it", () => {
    const paused = 1.4999;
    const stepped = snapToFrame(paused + 1 / 30, 30);

    expect(formatTimecode(paused, 30)).toBe("00:00:01:15");
    expect(formatTimecode(stepped, 30)).toBe("00:00:01:16");
  });
});
