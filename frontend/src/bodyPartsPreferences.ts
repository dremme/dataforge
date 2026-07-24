import { requestJson } from "./api/http";
import { withRetry } from "./utils/retry";

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

function toApiPartial(partial: Partial<BodyPartsSettings>): Partial<BodyPartsSettingsApi> {
  const body: Partial<BodyPartsSettingsApi> = {};
  if (partial.bodyDescription !== undefined) {
    body.body_description = partial.bodyDescription;
  }
  if (partial.faceDescription !== undefined) {
    body.face_description = partial.faceDescription;
  }
  if (partial.keywords !== undefined) {
    body.keywords = partial.keywords;
  }
  if (partial.elementDescription !== undefined) {
    body.element_description = partial.elementDescription;
  }
  return body;
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

export async function fetchBodyPartsSettings(): Promise<BodyPartsSettings> {
  const data = await requestJson<BodyPartsSettingsApi>("/api/preferences/body-parts");
  const settings = parseSettings(data);
  cacheBodyPartsSettings(settings);
  return settings;
}

async function fetchBodyPartsSettingsWithRetry(): Promise<BodyPartsSettings> {
  return withRetry(fetchBodyPartsSettings);
}

export async function updateBodyPartsSettings(
  partial: Partial<BodyPartsSettings>,
): Promise<BodyPartsSettings> {
  const data = await requestJson<BodyPartsSettingsApi>("/api/preferences/body-parts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toApiPartial(partial)),
  });
  const settings = parseSettings(data);
  cacheBodyPartsSettings(settings);
  return settings;
}

export async function loadBodyPartsSettings(): Promise<BodyPartsSettings> {
  try {
    return await fetchBodyPartsSettingsWithRetry();
  } catch {
    return readCachedBodyPartsSettings() ?? EMPTY_SETTINGS;
  }
}
