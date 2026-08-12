import type { AppIcon } from "@/shared/icons";
import { iconGrid2x2, iconGrid3x3, iconRows3 } from "@/shared/icons";
import type { GalleryDisplayMode } from "@/shared/types";

export const DEFAULT_DISPLAY_MODE: GalleryDisplayMode = "large";

export const DISPLAY_MODE_OPTIONS = [
  {
    value: "large" as const,
    label: "Large cards",
    ariaLabel: "Large cards",
    icon: iconGrid2x2,
  },
  {
    value: "small" as const,
    label: "Small cards",
    ariaLabel: "Small cards",
    icon: iconGrid3x3,
  },
  { value: "list" as const, label: "List", ariaLabel: "List", icon: iconRows3 },
] satisfies ReadonlyArray<{
  value: GalleryDisplayMode;
  label: string;
  ariaLabel: string;
  icon: AppIcon;
}>;

export function isGalleryDisplayMode(value: unknown): value is GalleryDisplayMode {
  return DISPLAY_MODE_OPTIONS.some((option) => option.value === value);
}

export function parseDisplayMode(value: unknown): GalleryDisplayMode {
  return isGalleryDisplayMode(value) ? value : DEFAULT_DISPLAY_MODE;
}

export function displayModeOption(mode: GalleryDisplayMode) {
  return DISPLAY_MODE_OPTIONS.find((option) => option.value === mode) ?? DISPLAY_MODE_OPTIONS[0];
}
