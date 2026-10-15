import { describe, expect, it } from "vitest";
import { makeClip, makeProject } from "@/test/videoProject";
import {
  amendAll,
  canRedo,
  canUndo,
  commitEdit,
  HISTORY_LIMIT,
  previewEdit,
  redoEdit,
  sameValue,
  settledProject,
  startHistory,
  undoEdit,
} from "./projectHistory";
import type { Project } from "./timeline";

const renamed = (project: Project, name: string): Project => ({ ...project, name });

describe("projectHistory", () => {
  it("steps back and forth through commits, and a new commit drops what was undone", () => {
    const start = makeProject();
    let history = startHistory(start);
    history = commitEdit(history, renamed(start, "One"));
    history = commitEdit(history, renamed(history.present, "Two"));

    history = undoEdit(undoEdit(history));
    expect(history.present).toBe(start);
    expect(canUndo(history)).toBe(false);
    history = redoEdit(history);
    expect(history.present.name).toBe("One");

    history = commitEdit(history, renamed(history.present, "Branch"));
    expect(canRedo(history)).toBe(false);
  });

  it("records nothing for a commit that changes nothing, even as a fresh object", () => {
    const start = makeProject({ clips: [makeClip("a", "v1", 0, 2)] });
    let history = commitEdit(startHistory(start), renamed(start, "One"));
    history = undoEdit(history);

    const copy = structuredClone(history.present);
    history = commitEdit(history, copy);

    expect(history.past).toHaveLength(0);
    expect(history.present).toBe(start);
    expect(canRedo(history)).toBe(true);
  });

  it("records a gesture's previews as one step from where the first one started", () => {
    const start = makeProject();
    let history = startHistory(start);
    history = previewEdit(history, renamed(start, "Dragging"));
    history = previewEdit(history, renamed(start, "Still dragging"));
    expect(settledProject(history)).toBe(start);

    history = commitEdit(history, renamed(start, "Dropped"));

    expect(history.past).toEqual([start]);
    expect(undoEdit(history).present).toBe(start);
  });

  it("records nothing for a gesture that ends where it started", () => {
    const start = makeProject();
    let history = previewEdit(startHistory(start), renamed(start, "Dragging"));
    history = commitEdit(history, structuredClone(start));

    expect(history.past).toHaveLength(0);
    expect(history.present).toBe(start);
  });

  it("settles a gesture that was never committed before undoing, so it is not lost", () => {
    const start = makeProject();
    let history = previewEdit(startHistory(start), renamed(start, "Dragged"));
    expect(canUndo(history)).toBe(true);

    history = undoEdit(history);
    expect(history.present).toBe(start);
    history = redoEdit(history);
    expect(history.present.name).toBe("Dragged");
  });

  it("applies an amendment to every snapshot, so undo neither records nor reverts it", () => {
    const start = makeProject();
    let history = commitEdit(startHistory(start), renamed(start, "One"));
    history = commitEdit(history, renamed(history.present, "Two"));
    history = undoEdit(history);

    history = amendAll(history, (project) => ({ ...project, width: 1280 }));

    expect(history.past).toHaveLength(1);
    expect(undoEdit(history).present.width).toBe(1280);
    expect(redoEdit(history).present).toMatchObject({ name: "Two", width: 1280 });
  });

  it("keeps the most recent steps", () => {
    let history = startHistory(makeProject());
    for (let step = 0; step <= HISTORY_LIMIT; step += 1) {
      history = commitEdit(history, renamed(history.present, `Step ${step}`));
    }

    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0].name).toBe("Step 0");
  });

  it("refuses an edit that changes a snapshot in place, which would rewrite history", () => {
    const history = commitEdit(
      startHistory(makeProject({ clips: [makeClip("a", "v1", 0, 2)] })),
      renamed(makeProject({ clips: [makeClip("a", "v1", 0, 2)] }), "One"),
    );

    expect(() => {
      history.present.clips[0].start = 5;
    }).toThrow(TypeError);
    expect(() => {
      (history.past[0].clips as unknown[]).push(makeClip("b", "v1", 2, 2));
    }).toThrow(TypeError);
  });
});

describe("sameValue", () => {
  it("compares structure, not identity or key order", () => {
    expect(sameValue({ a: [1, { b: 2 }], c: null }, { c: null, a: [1, { b: 2 }] })).toBe(true);
    expect(sameValue({ a: [1, 2] }, { a: [1, 2, 3] })).toBe(false);
    expect(sameValue({ a: 1 }, { b: 1 })).toBe(false);
    expect(sameValue([], {})).toBe(false);
    expect(sameValue({ a: null }, { a: 0 })).toBe(false);
  });
});
