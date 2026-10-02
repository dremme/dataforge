import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { putJson, requestJson } from "@/shared/api/http";
import { readStored, writeStored } from "@/shared/lib/storage";
import { mirroredPreference } from "@/shared/query/refreshPolicies";
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

const UI_SETTINGS_QUERY_KEY = ["ui-settings"] as const;

const THEME_PREFERENCES: readonly string[] = [
  "system",
  "light",
  "dark",
] satisfies ThemePreference[];

export function parseThemePreference(raw: string | null): ThemePreference {
  return raw !== null && THEME_PREFERENCES.includes(raw) ? (raw as ThemePreference) : "system";
}

function readCachedUiSettings(): UiSettings {
  return {
    sort: readStored(SORT_CACHE_KEY) ?? "",
    showAutomationSpecs: readStored(AUTOMATION_SPECS_CACHE_KEY) === "true",
    theme: parseThemePreference(readStored(THEME_CACHE_KEY)),
  };
}

function cacheUiSettings({ sort, showAutomationSpecs }: Partial<UiSettings>): void {
  if (sort !== undefined) writeStored(SORT_CACHE_KEY, sort);
  if (showAutomationSpecs !== undefined) {
    writeStored(AUTOMATION_SPECS_CACHE_KEY, String(showAutomationSpecs));
  }
}

function parseUiSettingsResponse(data: UiSettingsResponse): UiSettings {
  return {
    sort: data.sort,
    showAutomationSpecs: Boolean(data.show_automation_specs),
    theme: data.theme,
  };
}

// Theme saves also call updateUiSettings outside React, so they share the same queue.
let pendingUiSave: Promise<unknown> = Promise.resolve();

async function fetchUiSettings(signal: AbortSignal): Promise<UiSettings> {
  await pendingUiSave;
  signal.throwIfAborted();
  const settings = parseUiSettingsResponse(
    await requestJson<UiSettingsResponse>("/api/preferences/ui", { signal }),
  );
  signal.throwIfAborted();
  cacheUiSettings(settings);
  return settings;
}

export function updateUiSettings(partial: Partial<UiSettings>): Promise<UiSettings> {
  cacheUiSettings(partial);

  const body: UiSettingsUpdate = {};
  if (partial.sort !== undefined) body.sort = partial.sort;
  if (partial.showAutomationSpecs !== undefined) {
    body.show_automation_specs = partial.showAutomationSpecs;
  }
  if (partial.theme !== undefined) body.theme = partial.theme;

  const save = pendingUiSave.then(async () =>
    parseUiSettingsResponse(await putJson<UiSettingsResponse>("/api/preferences/ui", body)),
  );
  // A failed write must not prevent later choices from reaching the server.
  pendingUiSave = save.catch(() => {});
  return save;
}

export function uiSettingsQueryOptions() {
  return queryOptions({
    queryKey: UI_SETTINGS_QUERY_KEY,
    queryFn: ({ signal }) => fetchUiSettings(signal),
    ...mirroredPreference(readCachedUiSettings),
  });
}

export function useUiSettings(): UiSettings {
  return useQuery(uiSettingsQueryOptions()).data;
}

/** Applies a change at once and persists it in the background; a failed save is ignored. */
export function useUpdateUiSettings() {
  const queryClient = useQueryClient();

  const { mutate } = useMutation({
    // Save replies are whole snapshots; the local partial already holds the latest intent.
    mutationFn: updateUiSettings,
    onMutate: async (partial: Partial<UiSettings>) => {
      await queryClient.cancelQueries({ queryKey: UI_SETTINGS_QUERY_KEY });
      queryClient.setQueryData<UiSettings>(
        UI_SETTINGS_QUERY_KEY,
        (current) => current && { ...current, ...partial },
      );
    },
  });

  return mutate;
}
