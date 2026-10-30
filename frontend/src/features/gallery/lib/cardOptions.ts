import { CARD_ACTION_IDS } from "@/features/gallery/lib/cardActions";
import { DEFAULT_GALLERY_CARD_ACTIONS } from "@/shared/constants";
import { readStoredJson, writeStoredJson } from "@/shared/lib/storage";
import type {
  GalleryCardAction,
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
  /** Large cards only; the strongest tags in one row under the caption. */
  largeTags: boolean;
  listCaptionPreview: boolean;
  /** In catalog order, which is how the bar shows them. */
  cardActions: GalleryCardAction[];
}

export const SMALL_CARD_CAPTION_LINES = [0, 1, 2, 4] as const satisfies SmallCardCaptionLines[];
export const LARGE_CARD_CAPTION_LINES = [0, 2, 4, 6] as const satisfies LargeCardCaptionLines[];

export const DEFAULT_CARD_OPTIONS: GalleryCardOptions = {
  smallCaptionLines: 2,
  largeCaptionLines: 4,
  megapixels: true,
  largeAspectRatio: true,
  largeTags: true,
  listCaptionPreview: false,
  cardActions: [...DEFAULT_GALLERY_CARD_ACTIONS],
};

// Local mirror of the saved UI setting, so the first paint packs the masonry at its final size.
const CARD_OPTIONS_CACHE_KEY = "gallery-card-options";

function oneOf<T extends number>(options: readonly T[], value: unknown, fallback: T): T {
  return options.find((option) => option === value) ?? fallback;
}

/** A missing list is the default, while an empty one is a choice. */
function parseCardActions(value: unknown): GalleryCardAction[] {
  if (!Array.isArray(value)) return DEFAULT_CARD_OPTIONS.cardActions;
  return CARD_ACTION_IDS.filter((id) => value.includes(id));
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
    largeTags: Boolean(flag("largeTags")),
    listCaptionPreview: Boolean(flag("listCaptionPreview")),
    cardActions: parseCardActions(parsed.cardActions),
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
      largeTags: settings.large_tags,
      listCaptionPreview: settings.list_caption_preview,
      cardActions: settings.card_actions,
    }) ?? DEFAULT_CARD_OPTIONS
  );
}

export function cardOptionsToWire(options: GalleryCardOptions): GalleryCardSettings {
  return {
    small_caption_lines: options.smallCaptionLines,
    large_caption_lines: options.largeCaptionLines,
    megapixels: options.megapixels,
    large_aspect_ratio: options.largeAspectRatio,
    large_tags: options.largeTags,
    list_caption_preview: options.listCaptionPreview,
    card_actions: options.cardActions,
  };
}

export function sameCardOptions(a: GalleryCardOptions, b: GalleryCardOptions): boolean {
  const { cardActions: actionsA, ...restA } = a;
  const { cardActions: actionsB, ...restB } = b;
  return (
    actionsA.length === actionsB.length &&
    actionsA.every((action, index) => action === actionsB[index]) &&
    (Object.keys(restA) as (keyof typeof restA)[]).every((key) => restA[key] === restB[key])
  );
}
