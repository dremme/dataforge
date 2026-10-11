import { readStoredJson, writeStoredJson } from "@/shared/lib/storage";
import type {
  GalleryCardSettings,
  LargeCardCaptionLines,
  SmallCardCaptionLines,
} from "@/shared/types";

export interface GalleryCardOptions {
  /** 0 hides the caption and its status pill. */
  smallCaptionLines: SmallCardCaptionLines;
  /** 0 hides the caption and its status pill. */
  largeCaptionLines: LargeCardCaptionLines;
  /** Shown beside the file name on small and large cards. */
  megapixels: boolean;
  /** Large cards only; shown beside the megapixels. */
  largeAspectRatio: boolean;
  listCaptionPreview: boolean;
}

export const SMALL_CARD_CAPTION_LINES = [0, 1, 2, 4] as const satisfies SmallCardCaptionLines[];
export const LARGE_CARD_CAPTION_LINES = [0, 2, 4, 6] as const satisfies LargeCardCaptionLines[];

export const DEFAULT_CARD_OPTIONS: GalleryCardOptions = {
  smallCaptionLines: 2,
  largeCaptionLines: 4,
  megapixels: true,
  largeAspectRatio: true,
  listCaptionPreview: false,
};

// Local mirror of the saved UI setting, so the first paint packs the masonry at its final size.
const CARD_OPTIONS_CACHE_KEY = "gallery-card-options";

function oneOf<T extends number>(options: readonly T[], value: unknown, fallback: T): T {
  return options.find((option) => option === value) ?? fallback;
}

function parseCardOptions(value: unknown): GalleryCardOptions | null {
  if (!value || typeof value !== "object") return null;

  const parsed = value as Record<string, unknown>;
  const flag = (key: keyof GalleryCardOptions) =>
    typeof parsed[key] === "boolean" ? parsed[key] : DEFAULT_CARD_OPTIONS[key];
  return {
    smallCaptionLines: oneOf(
      SMALL_CARD_CAPTION_LINES,
      parsed.smallCaptionLines,
      DEFAULT_CARD_OPTIONS.smallCaptionLines,
    ),
    largeCaptionLines: oneOf(
      LARGE_CARD_CAPTION_LINES,
      parsed.largeCaptionLines,
      DEFAULT_CARD_OPTIONS.largeCaptionLines,
    ),
    megapixels: Boolean(flag("megapixels")),
    largeAspectRatio: Boolean(flag("largeAspectRatio")),
    listCaptionPreview: Boolean(flag("listCaptionPreview")),
  };
}

export function readCardOptions(): GalleryCardOptions {
  return readStoredJson(CARD_OPTIONS_CACHE_KEY, parseCardOptions, DEFAULT_CARD_OPTIONS);
}

export function cacheCardOptions(options: GalleryCardOptions): void {
  writeStoredJson(CARD_OPTIONS_CACHE_KEY, options);
}

/** Runs the server copy through the same parser as the local mirror. */
export function cardOptionsFromWire(settings: GalleryCardSettings): GalleryCardOptions {
  return (
    parseCardOptions({
      smallCaptionLines: settings.small_caption_lines,
      largeCaptionLines: settings.large_caption_lines,
      megapixels: settings.megapixels,
      largeAspectRatio: settings.large_aspect_ratio,
      listCaptionPreview: settings.list_caption_preview,
    }) ?? DEFAULT_CARD_OPTIONS
  );
}

export function cardOptionsToWire(options: GalleryCardOptions): GalleryCardSettings {
  return {
    small_caption_lines: options.smallCaptionLines,
    large_caption_lines: options.largeCaptionLines,
    megapixels: options.megapixels,
    large_aspect_ratio: options.largeAspectRatio,
    list_caption_preview: options.listCaptionPreview,
  };
}

export function sameCardOptions(a: GalleryCardOptions, b: GalleryCardOptions): boolean {
  return (Object.keys(a) as (keyof GalleryCardOptions)[]).every((key) => a[key] === b[key]);
}
