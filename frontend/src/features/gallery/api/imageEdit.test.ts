import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyImageEdit,
  fetchImageEditState,
  imageOriginalUrl,
  revertImageEdit,
} from "./imageEdit";
import { requestJson } from "@/shared/api/http";
import type { ImageEditSpec } from "@/shared/types";

vi.mock("@/shared/api/http", () => ({
  requestJson: vi.fn(),
  postJson: vi.fn(),
}));

const requestJsonMock = vi.mocked(requestJson);
const PHOTO = "C:\\Photos\\sunset.png";
const ENCODED = "C%3A%5CPhotos%5Csunset.png";

const SPEC: ImageEditSpec = {
  masks: [],
  crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
  mirror_h: true,
  mirror_v: false,
  rotate: 90,
  scale: 0.5,
};

beforeEach(() => {
  requestJsonMock.mockReset();
  requestJsonMock.mockResolvedValue({});
});

describe("imageOriginalUrl", () => {
  it("asks for the stored original rather than the current bytes", () => {
    expect(imageOriginalUrl(PHOTO)).toBe(`/api/media?path=${ENCODED}&original=1`);
  });

  it("carries no cache token, because the backup's bytes never change", () => {
    // Versioned URLs cache immutably; this one revalidates so it stays correct across applies.
    expect(imageOriginalUrl(PHOTO)).not.toContain("&v=");
  });
});

describe("fetchImageEditState", () => {
  it("reads the stored spec for one file", async () => {
    await fetchImageEditState(PHOTO);

    expect(requestJsonMock).toHaveBeenCalledWith(`/api/media/image-edit?path=${ENCODED}`);
  });
});

describe("applyImageEdit", () => {
  it("posts the spec as JSON", async () => {
    await applyImageEdit(PHOTO, SPEC);

    const [url, init] = requestJsonMock.mock.calls[0];
    expect(url).toBe(`/api/media/image-edit?path=${ENCODED}`);
    expect(init).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(String(init?.body))).toEqual(SPEC);
  });

  it("addresses no tab, because there is no progress to push back", async () => {
    await applyImageEdit(PHOTO, SPEC);

    expect(String(requestJsonMock.mock.calls[0][0])).not.toContain("tab=");
  });
});

describe("revertImageEdit", () => {
  it("posts to the revert endpoint", async () => {
    await revertImageEdit(PHOTO);

    expect(requestJsonMock).toHaveBeenCalledWith(`/api/media/image-edit/revert?path=${ENCODED}`, {
      method: "POST",
    });
  });
});
