import type { AppIcon } from "../icons";
import {
  iconCircleCheck,
  iconMessageCheck,
  iconMessageDashed,
  iconMessageWarning,
  iconSearch,
  iconImage,
  iconImages,
  iconVideo,
} from "../icons";
import type { CaptionFilter, MediaTypeFilter } from "./media";

export const FILTER_OPTIONS = [
  { value: "all" as const, label: "All", ariaLabel: "All media", icon: iconImages },
  {
    value: "captioned" as const,
    label: "Captioned",
    ariaLabel: "Captioned",
    icon: iconMessageCheck,
  },
  {
    value: "issue" as const,
    label: "With issues",
    ariaLabel: "With issues",
    icon: iconMessageWarning,
  },
  {
    value: "uncaptioned" as const,
    label: "Missing",
    ariaLabel: "Missing caption",
    icon: iconMessageDashed,
  },
] satisfies ReadonlyArray<{
  value: CaptionFilter;
  label: string;
  ariaLabel: string;
  icon: AppIcon;
}>;

export const MEDIA_TYPE_FILTER_OPTIONS = [
  { value: "all" as const, label: "All", ariaLabel: "All types", icon: iconImages },
  { value: "image" as const, label: "Images", ariaLabel: "Images", icon: iconImage },
  { value: "video" as const, label: "Videos", ariaLabel: "Videos", icon: iconVideo },
] satisfies ReadonlyArray<{
  value: MediaTypeFilter;
  label: string;
  ariaLabel: string;
  icon: AppIcon;
}>;

export type FilterEmptyVariant = "default" | "success" | "muted";

export interface FilterEmptyState {
  icon: AppIcon;
  title: string;
  description: string;
  variant: FilterEmptyVariant;
}

export function getFilterEmptyState(options: {
  filter: CaptionFilter;
  mediaTypeFilter: MediaTypeFilter;
  searchQuery: string;
  hasFilterMatches: boolean;
  imageCount: number;
  videoCount: number;
}): FilterEmptyState {
  const trimmedSearch = options.searchQuery.trim();
  const hasActiveSearch = trimmedSearch.length > 0;

  if (hasActiveSearch && options.hasFilterMatches) {
    return {
      icon: iconSearch,
      title: "No search matches",
      description: `Nothing in this folder matches "${trimmedSearch}". Try a different file or folder name, or caption phrase.`,
      variant: "muted",
    };
  }

  if (options.mediaTypeFilter === "video" && options.videoCount === 0) {
    return {
      icon: iconVideo,
      title: "No videos",
      description: "This folder has no supported video files.",
      variant: "muted",
    };
  }

  if (options.mediaTypeFilter === "image" && options.imageCount === 0) {
    return {
      icon: iconImage,
      title: "No images",
      description: "This folder has no supported image files.",
      variant: "muted",
    };
  }

  if (options.filter === "uncaptioned") {
    return {
      icon: iconCircleCheck,
      title: "All files captioned",
      description: "Every file in this folder has caption text. Nothing is missing.",
      variant: "success",
    };
  }

  if (options.filter === "issue") {
    return {
      icon: iconCircleCheck,
      title: "No files with issues",
      description: "None of the files in this folder have caption issues.",
      variant: "success",
    };
  }

  if (options.filter === "captioned") {
    return {
      icon: iconMessageDashed,
      title: "No captioned files",
      description: "None of the files in this folder have caption text yet.",
      variant: "default",
    };
  }

  return {
    icon: iconImages,
    title: "No matches",
    description: "No files match the current filter.",
    variant: "muted",
  };
}
