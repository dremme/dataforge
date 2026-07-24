import { isSysPrompt } from "./media";
import type { CaptionStatus, GalleryItem } from "./types";

export type CaptionStatusVariant = "success" | "warning" | "muted";

export interface CaptionStatusDisplay {
  message: string;
  variant: CaptionStatusVariant;
}

function resolveCaptionStatus(item: GalleryItem): CaptionStatus {
  return item.caption_status ?? (item.has_description ? "text" : "none");
}

const CARD_STATUS_MESSAGES: Partial<Record<CaptionStatus, CaptionStatusDisplay>> = {
  empty: {
    message: "Caption file is empty or unreadable",
    variant: "warning",
  },
  bboxes_only: {
    message: "Regions only — no description text",
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
      return `Caption file exists but has no usable text for this ${mediaLabel}.`;
    case "bboxes_only":
      return `Caption has region data only — no description text for this ${mediaLabel}.`;
    default:
      return `No caption available for this ${mediaLabel}.`;
  }
}

export function getCardCaptionDisplay(item: GalleryItem): CaptionStatusDisplay | null {
  if (item.description) return null;
  const messages = isSysPrompt(item) ? SYSPROMPT_STATUS_MESSAGES : CARD_STATUS_MESSAGES;
  return messages[resolveCaptionStatus(item)] ?? null;
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

  const variant = status === "empty" || status === "bboxes_only" ? "warning" : "muted";
  return { message: galleryItemStatusMessage(status, mediaLabel), variant };
}

export function getCardModifierClass(item: GalleryItem): string {
  if (item.has_issue_file) return "card--issue";
  if (item.has_description) return "card--captioned";

  const status = resolveCaptionStatus(item);
  if (status === "bboxes_only" || status === "empty") return "card--partial";
  return "card--plain";
}
