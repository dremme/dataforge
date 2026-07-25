import { requestJson } from "@/shared/api/http";
import { withRetry } from "@/shared/lib/retry";

export interface BodyPartsSettings {
  bodyDescription: string;
  faceDescription: string;
  keywords: string;
  elementDescription: string;
}

const BODY_PARTS_CACHE_KEY = "body-parts-settings";

const EMPTY_SETTINGS: BodyPartsSettings = {
  bodyDescription: "",
  faceDescription: "",
  keywords: "",
  elementDescription: "",
};

type BodyPartsSettingsApi = {
  body_description: string;
  face_description: string;
  keywords: string;
  element_description: string;
};

function parseSettings(data: BodyPartsSettingsApi): BodyPartsSettings {
  return {
    bodyDescription: data.body_description,
    faceDescription: data.face_description,
    keywords: data.keywords,
    elementDescription: data.element_description,
  };
}

export function readCachedBodyPartsSettings(): BodyPartsSettings | null {
  try {
    const stored = localStorage.getItem(BODY_PARTS_CACHE_KEY);
    if (!stored) return null;

    const data = JSON.parse(stored) as unknown;
    if (typeof data !== "object" || data === null) return null;

    const record = data as Record<string, unknown>;
    return {
      bodyDescription: typeof record.bodyDescription === "string" ? record.bodyDescription : "",
      faceDescription: typeof record.faceDescription === "string" ? record.faceDescription : "",
      keywords: typeof record.keywords === "string" ? record.keywords : "",
      elementDescription:
        typeof record.elementDescription === "string" ? record.elementDescription : "",
    };
  } catch {
    return null;
  }
}

export function cacheBodyPartsSettings(settings: BodyPartsSettings): void {
  try {
    localStorage.setItem(BODY_PARTS_CACHE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage access errors
  }
}

async function fetchBodyPartsSettings(): Promise<BodyPartsSettings> {
  const data = await requestJson<BodyPartsSettingsApi>("/api/preferences/body-parts");
  const settings = parseSettings(data);
  cacheBodyPartsSettings(settings);
  return settings;
}

export async function loadBodyPartsSettings(): Promise<BodyPartsSettings> {
  try {
    return await withRetry(fetchBodyPartsSettings);
  } catch {
    return readCachedBodyPartsSettings() ?? EMPTY_SETTINGS;
  }
}
