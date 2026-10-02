import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { createStoredStore, useStoredStore } from "@/shared/lib/storedStore";
import {
  parseThemePreference,
  THEME_CACHE_KEY,
  uiSettingsQueryOptions,
  updateUiSettings,
} from "@/shared/preferences/uiPreferences";
import type { ThemePreference } from "@/shared/types";

export type ResolvedTheme = "light" | "dark";

const LIGHT_QUERY = "(prefers-color-scheme: light)";

const saved = createStoredStore(THEME_CACHE_KEY, parseThemePreference);
let preview: ThemePreference | null = null;

export function resolveTheme(value: ThemePreference): ResolvedTheme {
  if (value !== "system") return value;
  return window.matchMedia?.(LIGHT_QUERY).matches ? "light" : "dark";
}

function applyTheme(): void {
  document.documentElement.dataset.theme = resolveTheme(preview ?? saved.get());
}

saved.subscribe(applyTheme);

export const getThemePreference = saved.get;

export function useThemePreference(): ThemePreference {
  return useStoredStore(saved);
}

export function setThemePreference(next: ThemePreference): void {
  saved.set(next);
  updateUiSettings({ theme: next }).catch(() => {
    // The choice is already applied and cached locally.
  });
}

/** Shows a theme without saving it; `null` returns to the saved one. */
export function previewThemePreference(next: ThemePreference | null): void {
  preview = next;
  applyTheme();
}

/** Follows the OS scheme and the server's copy. Mount once, under the query client. */
export function useThemeSync(): void {
  const supersededRef = useRef(false);
  const { data, isFetched, isError } = useQuery(uiSettingsQueryOptions());
  // The seed is this tab's own cache; only an answer from the server can bring news.
  const serverTheme = isFetched && !isError ? data.theme : null;

  useEffect(() => {
    applyTheme();

    // A choice made here before the server answers wins over the server's older copy.
    const unsubscribe = saved.subscribe(() => {
      supersededRef.current = true;
    });

    const media = window.matchMedia?.(LIGHT_QUERY);
    media?.addEventListener("change", applyTheme);

    return () => {
      unsubscribe();
      media?.removeEventListener("change", applyTheme);
    };
  }, []);

  useEffect(() => {
    if (serverTheme === null || supersededRef.current) return;
    supersededRef.current = true;
    saved.set(serverTheme);
  }, [serverTheme]);
}
