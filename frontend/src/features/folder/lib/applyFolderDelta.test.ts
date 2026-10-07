import { describe, expect, it } from "vitest";
import type { FolderChangesResponse, FolderResponse, GalleryItem, Subfolder } from "@/shared/types";
import { applyFolderDelta } from "./applyFolderDelta";

function item(name: string, overrides: Partial<GalleryItem> = {}): GalleryItem {
  return {
    name,
    path: `C:\\datasets\\sample\\${name}`,
    description: null,
    has_description: false,
    has_caption_file: false,
    issue_fixes: [],
    rule_findings: [],
    has_issue_file: false,
    has_duplicate_file: false,
    has_backup: false,
    has_candidate: false,
    caption_status: "none",
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
    has_sysprompt: false,
    sysprompt_applies: false,
    has_caption_backup: false,
    has_caption_rules: false,
    item_count: items.length,
    subfolder_count: 0,
    fingerprint: "before",
  };
}

function delta(overrides: Partial<FolderChangesResponse> = {}): FolderChangesResponse {
  return {
    full: false,
    fingerprint: "after",
    changed: [],
    removed: [],
    stale_subfolders: [],
    ...overrides,
  };
}

describe("applyFolderDelta", () => {
  it("replaces a changed item without moving it", () => {
    const current = folder([item("a.png"), item("b.png"), item("c.png")]);
    const captioned = item("b.png", {
      description: "A caption.",
      has_description: true,
      has_caption_file: true,
      caption_status: "text",
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

  it("blanks the counts of subfolders the server marks stale, so they are read again", () => {
    const counted = (name: string): Subfolder => ({
      name,
      path: `C:\\datasets\\sample\\${name}`,
      file_count: 4,
      captioned_count: 2,
      issue_count: 1,
      duplicate_count: 0,
    });
    const current = {
      ...folder([item("a.png")]),
      subfolders: [counted("album"), counted("staging")],
    };

    const next = applyFolderDelta(
      current,
      delta({ stale_subfolders: ["C:\\datasets\\sample\\staging"] }),
    );

    expect(next.subfolders[0]).toBe(current.subfolders[0]);
    expect(next.subfolders[1]).toEqual({
      name: "staging",
      path: "C:\\datasets\\sample\\staging",
      file_count: null,
      captioned_count: null,
      issue_count: null,
      duplicate_count: null,
    });
    expect(next.fingerprint).toBe("after");
  });
});
