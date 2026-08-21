import { requestJson } from "@/shared/api/http";
import type { GifToMp4Response, GifToMp4StateResponse } from "@/shared/types";

/**
 * Where the conversion would write, and whether that name is taken.
 *
 * Read before converting so the click can prompt ahead of an overwrite. The server
 * checks again when the write is asked for, so this drives the prompt, never the rule.
 */
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
