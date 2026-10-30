import { isCandidateItem } from "@/features/gallery/lib/candidateReview";
import { isDuplicateItem } from "@/features/gallery/lib/duplicates";
import { isResolvableIssueItem } from "@/features/gallery/lib/issues";
import {
  isAudio,
  isEditableAudio,
  isEditableImage,
  isEditableVideo,
  isMotion,
  isVideoProjectVideo,
} from "@/features/gallery/lib/itemKind";
import {
  iconArrowUpRight,
  iconCamera,
  iconClapperboard,
  iconCopy,
  iconCopyPlus,
  iconExpand,
  iconFiles,
  iconFolderInput,
  iconMessageWarning,
  iconPencilLine,
  iconScanSquare,
  iconSquarePen,
  iconTrash2,
  type AppIcon,
} from "@/shared/icons";
import type { GalleryCardAction, GalleryItem } from "@/shared/types";

interface CardActionSpec {
  label: string;
  icon: AppIcon;
  danger?: boolean;
  applies: (item: GalleryItem) => boolean;
}

const anyItem = () => true;

/** In display order: the bar and the settings checklist both follow this, never the saved list. */
export const CARD_ACTIONS: Record<GalleryCardAction, CardActionSpec> = {
  open: { label: "Open", icon: iconExpand, applies: anyItem },
  open_in_video_editor: {
    label: "Open in video editor",
    icon: iconClapperboard,
    applies: isVideoProjectVideo,
  },
  open_in_image_preview: {
    label: "Open in image preview",
    icon: iconArrowUpRight,
    applies: (item) => !isMotion(item) && !isAudio(item),
  },
  edit: {
    label: "Edit",
    icon: iconSquarePen,
    applies: (item) => isEditableImage(item) || isEditableVideo(item) || isEditableAudio(item),
  },
  save_frame: { label: "Save a frame as JPG", icon: iconCamera, applies: isMotion },
  copy_caption: {
    label: "Copy caption",
    icon: iconCopy,
    applies: (item) => Boolean(item.description),
  },
  copy_file: { label: "Copy file", icon: iconCopyPlus, applies: anyItem },
  move_file: { label: "Move file", icon: iconFolderInput, applies: anyItem },
  rename_file: { label: "Rename file", icon: iconPencilLine, applies: anyItem },
  resolve_issue: {
    label: "Resolve issue",
    icon: iconMessageWarning,
    applies: isResolvableIssueItem,
  },
  review_candidate: { label: "Review candidate", icon: iconScanSquare, applies: isCandidateItem },
  resolve_duplicate: { label: "Resolve duplicate", icon: iconFiles, applies: isDuplicateItem },
  delete: { label: "Delete", icon: iconTrash2, danger: true, applies: anyItem },
};

export const CARD_ACTION_IDS = Object.keys(CARD_ACTIONS) as GalleryCardAction[];

/** Selecting owns the card click, so only Open stays: it is the one way left to the viewer. */
export function cardActionsFor(
  item: GalleryItem,
  enabled: readonly GalleryCardAction[],
  selectionMode: boolean,
): GalleryCardAction[] {
  if (selectionMode) return ["open"];
  return CARD_ACTION_IDS.filter((id) => enabled.includes(id) && CARD_ACTIONS[id].applies(item));
}

export function withCardAction(
  enabled: readonly GalleryCardAction[],
  action: GalleryCardAction,
  on: boolean,
): GalleryCardAction[] {
  return CARD_ACTION_IDS.filter((id) => (id === action ? on : enabled.includes(id)));
}
