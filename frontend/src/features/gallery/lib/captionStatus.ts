import type { CaptionReadError, CaptionStatus, GalleryItem } from "@/shared/types";

export type CaptionStatusVariant = "success" | "warning" | "muted";

interface CaptionStatusDisplay {
  message: string;
  variant: CaptionStatusVariant;
}

function resolveCaptionStatus(item: GalleryItem): CaptionStatus {
  return item.caption_status ?? (item.has_description ? "text" : "none");
}

const CARD_STATUS_MESSAGES: Partial<Record<CaptionStatus, CaptionStatusDisplay>> = {
  empty: {
    message: "Caption file has no description text",
    variant: "warning",
  },
  unreadable: {
    message: "Caption file could not be read",
    variant: "warning",
  },
  none: {
    message: "No caption file found",
    variant: "muted",
  },
};

function galleryItemStatusMessage(item: GalleryItem, mediaLabel: string): string {
  switch (resolveCaptionStatus(item)) {
    case "empty":
      return `Caption file exists but has no description text for this ${mediaLabel}.`;
    case "unreadable":
      return unreadableCaptionMessage(item.caption_read_error ?? "access", mediaLabel);
    default:
      return `No caption available for this ${mediaLabel}.`;
  }
}

/** Why the caption is not shown; never presented as an empty caption to type over. */
function unreadableCaptionMessage(reason: CaptionReadError, mediaLabel: string): string {
  return reason === "encoding"
    ? `The caption file for this ${mediaLabel} is not UTF-8 text, so it is not shown.`
    : `The caption file for this ${mediaLabel} could not be opened. It may be open in another program.`;
}

export function getCardCaptionDisplay(item: GalleryItem): CaptionStatusDisplay | null {
  if (item.description) return null;
  return CARD_STATUS_MESSAGES[resolveCaptionStatus(item)] ?? null;
}

const ROW_STATUS_MESSAGES: Record<CaptionStatus, CaptionStatusDisplay> = {
  text: { message: "Captioned", variant: "success" },
  empty: { message: "Empty", variant: "warning" },
  unreadable: { message: "Unreadable", variant: "warning" },
  none: { message: "No caption", variant: "muted" },
};

export function getRowCaptionDisplay(item: GalleryItem): CaptionStatusDisplay {
  return ROW_STATUS_MESSAGES[resolveCaptionStatus(item)];
}

export function getGalleryItemCaptionDisplay(
  item: GalleryItem,
  mediaLabel: string,
): CaptionStatusDisplay {
  if (item.description) {
    return { message: item.description, variant: "success" };
  }

  const status = resolveCaptionStatus(item);
  if (status === "text") {
    return { message: item.description ?? "", variant: "success" };
  }

  const variant = status === "empty" || status === "unreadable" ? "warning" : "muted";
  return { message: galleryItemStatusMessage(item, mediaLabel), variant };
}

export function getCardModifierClass(item: GalleryItem): string {
  if (item.has_issue_file) return "card--issue";
  if (item.has_description) return "card--captioned";

  const status = resolveCaptionStatus(item);
  if (status === "empty" || status === "unreadable") return "card--partial";
  return "card--plain";
}
