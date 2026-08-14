import { isSysPrompt } from "./itemKind";
import type { CaptionStatus, GalleryItem } from "@/shared/types";

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
  none: {
    message: "No caption file found",
    variant: "muted",
  },
};

const SYSPROMPT_STATUS_MESSAGES: Partial<Record<CaptionStatus, CaptionStatusDisplay>> = {
  empty: {
    message: "System prompt file is empty",
    variant: "warning",
  },
  none: {
    message: "No system prompt yet",
    variant: "muted",
  },
};

function galleryItemStatusMessage(status: CaptionStatus, mediaLabel: string): string {
  switch (status) {
    case "empty":
      return `Caption file exists but has no description text for this ${mediaLabel}.`;
    default:
      return `No caption available for this ${mediaLabel}.`;
  }
}

export function getCardCaptionDisplay(item: GalleryItem): CaptionStatusDisplay | null {
  if (item.description) return null;
  const messages = isSysPrompt(item) ? SYSPROMPT_STATUS_MESSAGES : CARD_STATUS_MESSAGES;
  return messages[resolveCaptionStatus(item)] ?? null;
}

const ROW_STATUS_MESSAGES: Record<CaptionStatus, CaptionStatusDisplay> = {
  text: { message: "Captioned", variant: "success" },
  empty: { message: "Empty", variant: "warning" },
  none: { message: "No caption", variant: "muted" },
};

/**
 * Terse counterpart of {@link getCardCaptionDisplay} for list rows, which have a
 * single line to spend and so cannot carry a card's full sentence. Always
 * returns a value: a row shows its state even when captioned, where a card
 * shows the caption text instead.
 */
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

  if (isSysPrompt(item)) {
    const variant = status === "empty" ? "warning" : "muted";
    return {
      message:
        status === "empty"
          ? "System prompt file exists but has no content."
          : "No system prompt has been written for this folder yet.",
      variant,
    };
  }

  const variant = status === "empty" ? "warning" : "muted";
  return { message: galleryItemStatusMessage(status, mediaLabel), variant };
}

export function getCardModifierClass(item: GalleryItem): string {
  if (item.has_issue_file) return "card--issue";
  if (item.has_description) return "card--captioned";

  const status = resolveCaptionStatus(item);
  if (status === "empty") return "card--partial";
  return "card--plain";
}
