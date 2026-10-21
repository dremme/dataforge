import { requestJson } from "@/shared/api/http";

/** Sound with noise reduced and pitch moved, rendered by the server: the browser has neither. */
export interface AudioProxyRequest {
  path: string;
  noiseReduction: number;
  pitch: number;
  /** The gallery edit plays its original; the video editor plays the file as it is. */
  original: boolean;
}

function proxyParams({ path, noiseReduction, pitch, original }: AudioProxyRequest) {
  const params = new URLSearchParams({
    path,
    noise_reduction: String(noiseReduction),
    pitch: String(pitch),
  });
  if (original) params.set("original", "1");
  return params;
}

export function audioProxyUrl(request: AudioProxyRequest, cacheKey?: string): string {
  const params = proxyParams(request);
  if (cacheKey) params.set("v", cacheKey);
  return `/api/media/audio-proxy?${params}`;
}

/** Resolves once the proxy is rendered, so the player can switch to it without a stall. */
export async function prepareAudioProxy(
  request: AudioProxyRequest,
  signal?: AbortSignal,
): Promise<void> {
  await requestJson<void>(`/api/media/audio-proxy?${proxyParams(request)}`, {
    method: "POST",
    signal,
  });
}
