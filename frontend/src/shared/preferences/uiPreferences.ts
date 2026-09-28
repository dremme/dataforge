import { putJson, requestJson } from "@/shared/api/http";
import { withRetry } from "@/shared/lib/retry";
import { readStored, writeStored } from "@/shared/lib/storage";
import type { ThemePreference, UiSettingsResponse, UiSettingsUpdate } from "@/shared/types";

export interface UiSettings {
  sort: string;
  showAutomationSpecs: boolean;
  theme: ThemePreference;
}

const SORT_CACHE_KEY = "gallery-sort";
const AUTOMATION_SPECS_CACHE_KEY = "automation-specs-visible";
/** `index.html` reads this key before first paint; rename both together. */
export const THEME_CACHE_KEY = "ui-theme";

const THEME_PREFERENCES: readonly string[] = [
  "system",
  "light",
  "dark",
] satisfies ThemePreference[];

export function parseThemePreference(raw: string | null): ThemePreference {
  return raw !== null && THEME_PREFERENCES.includes(raw) ? (raw as ThemePreference) : "system";
}

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
    theme: data.theme,
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
  if (partial.theme !== undefined) {
    body.theme = partial.theme;
  }

  const data = await putJson<UiSettingsResponse>("/api/preferences/ui", body);
  const settings = parseUiSettingsResponse(data);
  cacheSortPreference(settings.sort);
  cacheAutomationSpecsPreference(settings.showAutomationSpecs);
  return settings;
}

async function loadUiSettingsOnce(): Promise<UiSettings> {
  try {
    return await fetchUiSettingsWithRetry();
  } catch {
    const cachedSort = readCachedSortPreference();
    const cachedSpecs = readCachedAutomationSpecsPreference();
    return {
      sort: cachedSort ?? "",
      showAutomationSpecs: cachedSpecs ?? false,
      theme: parseThemePreference(readStored(THEME_CACHE_KEY)),
    };
  }
}

let inflight: Promise<UiSettings> | null = null;

/** Every startup reader shares one request. */
export function loadUiSettings(): Promise<UiSettings> {
  inflight ??= loadUiSettingsOnce().finally(() => {
    inflight = null;
  });
  return inflight;
}
