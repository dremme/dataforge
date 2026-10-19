import { describe, expect, it } from "vitest";
import type { VideoProjectVersionSummary } from "@/shared/types";
import { groupVersionsByDay } from "./versionDays";

function version(id: string, createdAt: Date): VideoProjectVersionSummary {
  return {
    id,
    created_at: createdAt.toISOString(),
    label: null,
    revision: 1,
    name: "Edit",
    duration: 10,
    clip_count: 1,
  };
}

describe("groupVersionsByDay", () => {
  it("groups newest-first versions into labelled local days", () => {
    const now = new Date(2026, 2, 15, 12, 0).getTime();
    const days = groupVersionsByDay(
      [
        version("a", new Date(2026, 2, 15, 11, 0)),
        version("b", new Date(2026, 2, 15, 8, 0)),
        version("c", new Date(2026, 2, 14, 20, 0)),
        version("d", new Date(2026, 2, 10, 9, 0)),
      ],
      now,
    );

    expect(days.map((day) => [day.label, day.versions.map((entry) => entry.id)])).toEqual([
      ["Today", ["a", "b"]],
      ["Yesterday", ["c"]],
      ["Mar 10, 2026", ["d"]],
    ]);
  });
});
