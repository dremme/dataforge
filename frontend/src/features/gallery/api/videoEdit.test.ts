import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyVideoEdit,
  cancelVideoEdit,
  fetchVideoEditState,
  revertVideoEdit,
  videoOriginalUrl,
} from "./videoEdit";
import { requestJson } from "@/shared/api/http";
import { serverEventsTabId } from "@/shared/api/eventStream";
import type { VideoEditSpec } from "@/shared/types";

vi.mock("@/shared/api/http", () => ({
  requestJson: vi.fn(),
  postJson: vi.fn(),
}));

const requestJsonMock = vi.mocked(requestJson);
const CLIP = "C:\\Photos\\clip.mp4";
const ENCODED = "C%3A%5CPhotos%5Cclip.mp4";

const SPEC: VideoEditSpec = {
  masks: [],
  trim_start: 1,
  trim_end: 4,
  crop: null,
  speed: 2,
  scale: 0.5,
  volume: 1,
};

beforeEach(() => {
  requestJsonMock.mockReset();
  requestJsonMock.mockResolvedValue({});
});

describe("videoOriginalUrl", () => {
  it("asks for the stored original rather than the current bytes", () => {
    expect(videoOriginalUrl(CLIP)).toBe(`/api/media?path=${ENCODED}&original=1`);
  });

  it("keeps the cache token, since the original changes when the file does", () => {
    expect(videoOriginalUrl(CLIP, "17-42")).toBe(`/api/media?path=${ENCODED}&v=17-42&original=1`);
  });
});

describe("fetchVideoEditState", () => {
  it("reads the stored spec for one file", async () => {
    await fetchVideoEditState(CLIP);

    expect(requestJsonMock).toHaveBeenCalledWith(`/api/media/video-edit?path=${ENCODED}`);
  });
});

describe("applyVideoEdit", () => {
  it("posts the spec as JSON", async () => {
    await applyVideoEdit(CLIP, SPEC);

    const [url, init] = requestJsonMock.mock.calls[0];
    expect(url).toContain(`/api/media/video-edit?path=${ENCODED}`);
    expect(init).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(String(init?.body))).toEqual(SPEC);
  });

  it("addresses the progress frames to this tab", async () => {
    await applyVideoEdit(CLIP, SPEC);

    const [url] = requestJsonMock.mock.calls[0];
    expect(url).toContain(`tab=${encodeURIComponent(serverEventsTabId())}`);
  });
});

describe("revertVideoEdit", () => {
  it("posts to the revert endpoint", async () => {
    await revertVideoEdit(CLIP);

    expect(requestJsonMock).toHaveBeenCalledWith(`/api/media/video-edit/revert?path=${ENCODED}`, {
      method: "POST",
    });
  });
});

describe("cancelVideoEdit", () => {
  it("posts to the cancel endpoint without waiting on a body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await cancelVideoEdit(CLIP);

    expect(fetchMock).toHaveBeenCalledWith(`/api/media/video-edit/cancel?path=${ENCODED}`, {
      method: "POST",
    });
  });
});
