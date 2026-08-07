import { putJson, requestJson } from "@/shared/api/http";
import { withRetry } from "@/shared/lib/retry";
import type {
  WatermarkOpacity,
  WatermarkPosition,
  WatermarkSettingsResponse,
  WatermarkSettingsUpdate,
  WatermarkSizeName,
} from "@/shared/types";

export type WatermarkSettings = WatermarkSettingsResponse;

export const DEFAULT_WATERMARK_SIZE: WatermarkSizeName = "medium";
export const DEFAULT_WATERMARK_OPACITY: WatermarkOpacity = 50;
export const DEFAULT_WATERMARK_POSITION: WatermarkPosition = "bottom";

const SIZES: readonly WatermarkSizeName[] = ["small", "medium", "large"];
const OPACITIES: readonly WatermarkOpacity[] = [25, 50, 75];
const POSITIONS: readonly WatermarkPosition[] = ["top", "center", "bottom"];

function parseSize(value: unknown): WatermarkSizeName {
  return SIZES.includes(value as WatermarkSizeName)
    ? (value as WatermarkSizeName)
    : DEFAULT_WATERMARK_SIZE;
}

function parseOpacity(value: unknown): WatermarkOpacity {
  return OPACITIES.includes(value as WatermarkOpacity)
    ? (value as WatermarkOpacity)
    : DEFAULT_WATERMARK_OPACITY;
}

function parsePosition(value: unknown): WatermarkPosition {
  return POSITIONS.includes(value as WatermarkPosition)
    ? (value as WatermarkPosition)
    : DEFAULT_WATERMARK_POSITION;
}

function parseSettings(data: Partial<WatermarkSettingsResponse>): WatermarkSettings {
  return {
    text: typeof data.text === "string" ? data.text : "",
    size: parseSize(data.size),
    opacity: parseOpacity(data.opacity),
    position: parsePosition(data.position),
  };
}

export function emptyWatermarkSettings(): WatermarkSettings {
  return {
    text: "",
    size: DEFAULT_WATERMARK_SIZE,
    opacity: DEFAULT_WATERMARK_OPACITY,
    position: DEFAULT_WATERMARK_POSITION,
  };
}

async function fetchWatermarkSettings(): Promise<WatermarkSettings> {
  return parseSettings(
    await requestJson<Partial<WatermarkSettingsResponse>>("/api/preferences/watermark"),
  );
}

/** Never rejects: a preferences outage must not stop the user from starting a job. */
export async function loadWatermarkSettings(): Promise<WatermarkSettings> {
  try {
    return await withRetry(fetchWatermarkSettings);
  } catch {
    return emptyWatermarkSettings();
  }
}

export async function updateWatermarkSettings(
  partial: WatermarkSettingsUpdate,
): Promise<WatermarkSettings> {
  const data = await putJson<Partial<WatermarkSettingsResponse>>(
    "/api/preferences/watermark",
    partial,
  );
  return parseSettings(data);
}
