import { describe, expect, it } from "vitest";
import { collectGalleryPreviewTargets } from "./visiblePrefetch";
import type { GalleryItem } from "@/shared/types";

const rows = Array.from({ length: 8 }, (_, i) => [
  { path: `C:\\Photos\\frame-${i}.jpg`, size: i, media_type: "image" } as GalleryItem,
]);

describe("gallery prefetch targets", () => {
  it("keeps the existing one-row-before and three-rows-after range", () => {
    const targets = collectGalleryPreviewTargets((i) => rows[i], rows.length, [
      { index: 2 },
      { index: 3 },
    ]);
    expect(targets).toHaveLength(6);
    expect(targets.map((target) => target.priority)).toEqual([
      "prefetch",
      "visible",
      "visible",
      "prefetch",
      "prefetch",
      "prefetch",
    ]);
    expect(targets[0].url).toContain("frame-1.jpg");
    expect(targets[0].fallbackUrl).toContain("/api/media?");
  });
  it("bounds masonry neighbors at the folder edges", () => {
    const targets = collectGalleryPreviewTargets(
      (i) => rows[i],
      rows.length,
      [{ index: 0 }, { index: 1 }],
      { before: 3, after: 9 },
    );
    expect(targets).toHaveLength(8);
  });
  it("returns no demands for an empty virtual range", () => {
    expect(collectGalleryPreviewTargets((i) => rows[i], rows.length, [])).toEqual([]);
  });
});
