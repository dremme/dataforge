import { useEffect } from "react";
import { createStoredStore, useStoredStore } from "@/shared/lib/storedStore";
import {
  loadUiSettings,
  parseThemePreference,
  THEME_CACHE_KEY,
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

/** Follows the OS scheme and the server's copy. Mount once at the root. */
export function useThemeSync(): void {
  useEffect(() => {
    applyTheme();

    let superseded = false;
    const unsubscribe = saved.subscribe(() => {
      superseded = true;
    });
    loadUiSettings().then((settings) => {
      if (!superseded) saved.set(settings.theme);
    });

    const media = window.matchMedia?.(LIGHT_QUERY);
    media?.addEventListener("change", applyTheme);

    return () => {
      superseded = true;
      unsubscribe();
      media?.removeEventListener("change", applyTheme);
    };
  }, []);
}
