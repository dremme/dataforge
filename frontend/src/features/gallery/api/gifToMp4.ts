import { requestJson } from "@/shared/api/http";
import type { GifToMp4Response, GifToMp4StateResponse } from "@/shared/types";

export async function fetchGifToMp4State(mediaPath: string): Promise<GifToMp4StateResponse> {
  const params = new URLSearchParams({ path: mediaPath });
  return requestJson<GifToMp4StateResponse>(`/api/media/gif-to-mp4?${params}`);
}

export async function convertGifToMp4(
  mediaPath: string,
  overwrite = false,
): Promise<GifToMp4Response> {
  const params = new URLSearchParams({ path: mediaPath, overwrite: String(overwrite) });
  return requestJson<GifToMp4Response>(`/api/media/gif-to-mp4?${params}`, { method: "POST" });
}
