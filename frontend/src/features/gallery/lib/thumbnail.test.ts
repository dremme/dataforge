import { describe, expect, it } from "vitest";
import { galleryItemMediaUrl, galleryThumbnailPreviewUrl, mediaCacheKey } from "./thumbnail";

describe("galleryThumbnail", () => {
  it("builds stable cache keys from modified timestamps", () => {
    expect(mediaCacheKey("2026-06-19T12:00:00.000Z", 4096)).toBe(
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

describe("galleryItemMediaUrl", () => {
  const item = {
    path: "C:\\Photos\\sunset.png",
    modified_at: "2026-06-19T12:00:00.000Z",
    size: 4096,
  };

  it("versions full-size media with the same token as the thumbnail", () => {
    const url = galleryItemMediaUrl(item);
    expect(url).toContain("/api/media?");
    expect(url).toContain(`v=${Date.parse(item.modified_at)}-4096`);
  });

  it("changes when the file is edited in place", () => {
    const edited = { ...item, modified_at: "2026-06-19T12:30:00.000Z", size: 5120 };
    expect(galleryItemMediaUrl(edited)).not.toBe(galleryItemMediaUrl(item));
  });
});
