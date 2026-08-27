import { putJson, requestJson } from "@/shared/api/http";
import { withRetry } from "@/shared/lib/retry";
import { readStored, writeStored } from "@/shared/lib/storage";
import type { UiSettingsResponse, UiSettingsUpdate } from "@/shared/types";

export interface UiSettings {
  sort: string;
  showAutomationSpecs: boolean;
}

const SORT_CACHE_KEY = "gallery-sort";
const AUTOMATION_SPECS_CACHE_KEY = "automation-specs-visible";

export function readCachedSortPreference(): string | null {
  return readStored(SORT_CACHE_KEY);
}

export function readCachedAutomationSpecsPreference(): boolean | null {
  const stored = readStored(AUTOMATION_SPECS_CACHE_KEY);
  if (stored === "true") return true;
  if (stored === "false") return false;
  return null;
}

function cacheSortPreference(sort: string): void {
  writeStored(SORT_CACHE_KEY, sort);
}

function cacheAutomationSpecsPreference(showAutomationSpecs: boolean): void {
  writeStored(AUTOMATION_SPECS_CACHE_KEY, String(showAutomationSpecs));
}

function parseUiSettingsResponse(data: UiSettingsResponse): UiSettings {
  return {
    sort: data.sort,
    showAutomationSpecs: Boolean(data.show_automation_specs),
  };
}

async function fetchUiSettings(): Promise<UiSettings> {
  const data = await requestJson<UiSettingsResponse>("/api/preferences/ui");
  const settings = parseUiSettingsResponse(data);
  cacheSortPreference(settings.sort);
  cacheAutomationSpecsPreference(settings.showAutomationSpecs);
  return settings;
}

async function fetchUiSettingsWithRetry(): Promise<UiSettings> {
  return withRetry(fetchUiSettings);
}

export async function updateUiSettings(partial: Partial<UiSettings>): Promise<UiSettings> {
  if (partial.sort !== undefined) {
    cacheSortPreference(partial.sort);
  }
  if (partial.showAutomationSpecs !== undefined) {
    cacheAutomationSpecsPreference(partial.showAutomationSpecs);
  }

  const body: UiSettingsUpdate = {};
  if (partial.sort !== undefined) {
    body.sort = partial.sort;
  }
  if (partial.showAutomationSpecs !== undefined) {
    body.show_automation_specs = partial.showAutomationSpecs;
  }

  const data = await putJson<UiSettingsResponse>("/api/preferences/ui", body);
  const settings = parseUiSettingsResponse(data);
  cacheSortPreference(settings.sort);
  cacheAutomationSpecsPreference(settings.showAutomationSpecs);
  return settings;
}

export async function loadUiSettings(): Promise<UiSettings> {
  try {
    return await fetchUiSettingsWithRetry();
  } catch {
    const cachedSort = readCachedSortPreference();
    const cachedSpecs = readCachedAutomationSpecsPreference();
    return {
      sort: cachedSort ?? "",
      showAutomationSpecs: cachedSpecs ?? false,
    };
  }
}
