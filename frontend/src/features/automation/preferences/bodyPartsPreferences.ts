import { putJson, requestJson } from "@/shared/api/http";
import { withRetry } from "@/shared/lib/retry";

export interface BodyPartsSettings {
  bodyDescription: string;
  faceDescription: string;
  keywords: string;
  elementDescription: string;
}

const EMPTY_BODY_PARTS_SETTINGS: BodyPartsSettings = {
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

async function fetchBodyPartsSettings(): Promise<BodyPartsSettings> {
  const data = await requestJson<BodyPartsSettingsApi>("/api/preferences/body-parts");
  return parseSettings(data);
}

export async function loadBodyPartsSettings(): Promise<BodyPartsSettings> {
  try {
    return await withRetry(fetchBodyPartsSettings);
  } catch {
    return EMPTY_BODY_PARTS_SETTINGS;
  }
}

export async function updateBodyPartsSettings(
  partial: Partial<BodyPartsSettings>,
): Promise<BodyPartsSettings> {
  const data = await putJson<BodyPartsSettingsApi>(
    "/api/preferences/body-parts",
    toApiPartial(partial),
  );
  return parseSettings(data);
}
