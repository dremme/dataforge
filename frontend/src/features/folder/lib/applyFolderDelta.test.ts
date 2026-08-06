import { describe, expect, it } from "vitest";
import type { FolderChangesResponse, FolderResponse, GalleryItem } from "@/shared/types";
import { applyFolderDelta } from "./applyFolderDelta";

function item(name: string, overrides: Partial<GalleryItem> = {}): GalleryItem {
  return {
    name,
    path: `C:\\datasets\\sample\\${name}`,
    description: null,
    has_description: false,
    has_caption_file: false,
    issue_fixes: [],
    has_issue_file: false,
    caption_status: "none",
    caption_file_type: null,
    media_type: "image",
    ...overrides,
  };
}

function folder(items: GalleryItem[]): FolderResponse {
  return {
    path: "C:\\datasets\\sample",
    home: "C:\\Users\\sample",
    parent: "C:\\datasets",
    breadcrumbs: [],
    subfolders: [],
    items,
    sysprompt: null,
    has_caption_backup: false,
    item_count: items.length,
    subfolder_count: 0,
    fingerprint: "before",
  };
}

function delta(overrides: Partial<FolderChangesResponse> = {}): FolderChangesResponse {
  return { full: false, fingerprint: "after", changed: [], removed: [], ...overrides };
}

describe("applyFolderDelta", () => {
  it("replaces a changed item without moving it", () => {
    const current = folder([item("a.png"), item("b.png"), item("c.png")]);
    const captioned = item("b.png", {
      description: "A caption.",
      has_description: true,
      has_caption_file: true,
      caption_status: "text",
      caption_file_type: "txt",
    });

    const next = applyFolderDelta(current, delta({ changed: [captioned] }));

    expect(next.items.map((entry) => entry.name)).toEqual(["a.png", "b.png", "c.png"]);
    expect(next.items[1].description).toBe("A caption.");
    expect(next.fingerprint).toBe("after");
  });

  it("drops removed items and keeps the count honest", () => {
    const current = folder([item("a.png"), item("b.png")]);

    const next = applyFolderDelta(current, delta({ removed: ["C:\\datasets\\sample\\a.png"] }));

    expect(next.items.map((entry) => entry.name)).toEqual(["b.png"]);
    expect(next.item_count).toBe(1);
  });

  it("appends an item it has not seen before", () => {
    const current = folder([item("a.png")]);

    const next = applyFolderDelta(current, delta({ changed: [item("b.png")] }));

    expect(next.items.map((entry) => entry.name)).toEqual(["a.png", "b.png"]);
    expect(next.item_count).toBe(2);
  });

  it("handles an add and a remove in one delta", () => {
    const current = folder([item("a.png"), item("b.png")]);

    const next = applyFolderDelta(
      current,
      delta({ changed: [item("c.png")], removed: ["C:\\datasets\\sample\\a.png"] }),
    );

    expect(next.items.map((entry) => entry.name)).toEqual(["b.png", "c.png"]);
    expect(next.item_count).toBe(2);
  });

  it("keeps the same object when nothing moved, so React can skip the render", () => {
    const current = folder([item("a.png")]);

    expect(applyFolderDelta(current, delta({ fingerprint: "before" }))).toBe(current);
  });

  it("still advances the fingerprint when only unlisted entries changed", () => {
    const current = folder([item("a.png")]);

    const next = applyFolderDelta(current, delta());

    expect(next).not.toBe(current);
    expect(next.fingerprint).toBe("after");
    expect(next.items).toEqual(current.items);
  });
});
