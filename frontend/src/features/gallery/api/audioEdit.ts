import { requestJson } from "@/shared/api/http";
import { mediaUrl } from "@/features/gallery/api/media";
import { serverEventsTabId } from "@/shared/api/eventStream";
import type {
  AudioEditResponse,
  AudioEditSpec,
  AudioEditStateResponse,
  AudioLoudnessResponse,
} from "@/shared/types";

/** Original the editor plays; a spec is against it, so a trimmed render misplaces handles. */
export function audioOriginalUrl(mediaPath: string, cacheKey?: string): string {
  return `${mediaUrl(mediaPath, cacheKey)}&original=1`;
}

/** The original's sound across its whole length, for the trim track to draw. */
export function audioOriginalWaveformUrl(
  mediaPath: string,
  duration: number,
  width: number,
  height: number,
  cacheKey: string,
): string {
  const params = new URLSearchParams({
    path: mediaPath,
    start: "0",
    duration: String(duration),
    width: String(width),
    height: String(height),
    original: "1",
    v: cacheKey,
  });
  return `/api/video-projects/waveform?${params}`;
}

export async function fetchAudioEditState(mediaPath: string): Promise<AudioEditStateResponse> {
  const params = new URLSearchParams({ path: mediaPath });
  return requestJson<AudioEditStateResponse>(`/api/media/audio-edit?${params}`);
}

export async function applyAudioEdit(
  mediaPath: string,
  spec: AudioEditSpec,
): Promise<AudioEditResponse> {
  const params = new URLSearchParams({ path: mediaPath, tab: serverEventsTabId() });
  return requestJson<AudioEditResponse>(`/api/media/audio-edit?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(spec),
  });
}

/** Loudness before the level stage, so the preview plays a normalize at the render's gain. */
export async function measureAudioLoudness(
  mediaPath: string,
  spec: AudioEditSpec,
  signal?: AbortSignal,
): Promise<AudioLoudnessResponse> {
  const params = new URLSearchParams({ path: mediaPath });
  return requestJson<AudioLoudnessResponse>(`/api/media/audio-edit/loudness?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(spec),
    signal,
  });
}

export async function cancelAudioEdit(mediaPath: string): Promise<void> {
  const params = new URLSearchParams({ path: mediaPath });
  await fetch(`/api/media/audio-edit/cancel?${params}`, { method: "POST" });
}

export async function revertAudioEdit(mediaPath: string): Promise<AudioEditResponse> {
  const params = new URLSearchParams({ path: mediaPath });
  return requestJson<AudioEditResponse>(`/api/media/audio-edit/revert?${params}`, {
    method: "POST",
  });
}
