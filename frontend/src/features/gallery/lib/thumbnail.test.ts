import { describe, expect, it } from "vitest";
import { galleryThumbnailPreviewUrl, thumbnailCacheKey } from "./thumbnail";

describe("galleryThumbnail", () => {
  it("builds stable cache keys from modified timestamps", () => {
    expect(thumbnailCacheKey("2026-06-19T12:00:00.000Z", 4096)).toBe(
      `${Date.parse("2026-06-19T12:00:00.000Z")}-4096`,
    );
  });

  it("builds preview URLs from gallery item fields", () => {
    const url = galleryThumbnailPreviewUrl(
      "C:\\Photos\\sunset.png",
      "2026-06-19T12:00:00.000Z",
      4096,
    );
    expect(url).toContain("/api/thumbnail?");
    expect(url).toContain("w=400");
  });
});
