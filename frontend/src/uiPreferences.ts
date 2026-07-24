import { requestJson } from "./api/http";
import { DEFAULT_SORT, parseSortOption, type SortOption } from "./gallery/media";
import { withRetry } from "./utils/retry";

export interface UiSettings {
  sort: SortOption;
  showAutomationSpecs: boolean;
}

const SORT_CACHE_KEY = "gallery-sort";
const AUTOMATION_SPECS_CACHE_KEY = "automation-specs-visible";

export function readCachedSortPreference(): SortOption | null {
  try {
    const stored = localStorage.getItem(SORT_CACHE_KEY);
    if (stored) return parseSortOption(stored);
  } catch {
    // Ignore storage access errors
  }
  return null;
}

export function readCachedAutomationSpecsPreference(): boolean | null {
  try {
    const stored = localStorage.getItem(AUTOMATION_SPECS_CACHE_KEY);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {
    // Ignore storage access errors
  }
  return null;
}

export function cacheSortPreference(sort: SortOption): void {
  try {
    localStorage.setItem(SORT_CACHE_KEY, sort);
  } catch {
    // Ignore storage access errors
  }
}

export function cacheAutomationSpecsPreference(showAutomationSpecs: boolean): void {
  try {
    localStorage.setItem(AUTOMATION_SPECS_CACHE_KEY, String(showAutomationSpecs));
  } catch {
    // Ignore storage access errors
  }
}

function parseUiSettingsResponse(data: {
  sort: string;
  show_automation_specs?: boolean;
}): UiSettings {
  return {
    sort: parseSortOption(data.sort),
    showAutomationSpecs: Boolean(data.show_automation_specs),
  };
}

export async function fetchUiSettings(): Promise<UiSettings> {
  const data = await requestJson<{ sort: string; show_automation_specs?: boolean }>(
    "/api/preferences/ui",
  );
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

  const body: { sort?: SortOption; show_automation_specs?: boolean } = {};
  if (partial.sort !== undefined) {
    body.sort = partial.sort;
  }
  if (partial.showAutomationSpecs !== undefined) {
    body.show_automation_specs = partial.showAutomationSpecs;
  }

  const data = await requestJson<{ sort: string; show_automation_specs?: boolean }>(
    "/api/preferences/ui",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
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
      sort: cachedSort ?? DEFAULT_SORT,
      showAutomationSpecs: cachedSpecs ?? false,
    };
  }
}
