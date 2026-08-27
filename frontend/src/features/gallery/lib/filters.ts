import type { AppIcon } from "@/shared/icons";
import {
  iconCircleCheck,
  iconFiles,
  iconMessageCheck,
  iconMessageDashed,
  iconMessageWarning,
  iconScanSquare,
  iconSearch,
  iconImage,
  iconImages,
  iconVideo,
} from "@/shared/icons";
import type { FileFilter, ItemFilter, MediaTypeFilter } from "./query";

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
  value: ItemFilter;
  label: string;
  ariaLabel: string;
  icon: AppIcon;
}>;

export const FILE_FILTER_OPTIONS = [
  { value: "all" as const, label: "All", ariaLabel: "All files", icon: iconImages },
  {
    value: "duplicates" as const,
    label: "Duplicates",
    ariaLabel: "Duplicates",
    icon: iconFiles,
  },
  {
    value: "candidates" as const,
    label: "Candidates",
    ariaLabel: "ComfyUI candidates",
    icon: iconScanSquare,
  },
] satisfies ReadonlyArray<{
  value: FileFilter;
  label: string;
  ariaLabel: string;
  icon: AppIcon;
}>;

export const MEDIA_TYPE_FILTER_OPTIONS = [
  { value: "all" as const, label: "All", ariaLabel: "All types", icon: iconImages },
  { value: "image" as const, label: "Images", ariaLabel: "Images", icon: iconImage },
  { value: "video" as const, label: "Videos", ariaLabel: "Videos and GIFs", icon: iconVideo },
] satisfies ReadonlyArray<{
  value: MediaTypeFilter;
  label: string;
  ariaLabel: string;
  icon: AppIcon;
}>;

type FilterEmptyVariant = "default" | "success" | "muted";

export interface FilterEmptyState {
  icon: AppIcon;
  title: string;
  description: string;
  variant: FilterEmptyVariant;
}

export function getFilterEmptyState(options: {
  filter: ItemFilter;
  mediaTypeFilter: MediaTypeFilter;
  fileFilter: FileFilter;
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
      description: `Nothing in this folder matches "${trimmedSearch}". Try a different search phrase.`,
      variant: "muted",
    };
  }

  if (options.mediaTypeFilter === "video" && options.videoCount === 0) {
    return {
      icon: iconVideo,
      title: "No videos",
      description: "This folder has no supported video or GIF files.",
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

  // Files axis first: "All files captioned" misdirects when nothing here is a duplicate.
  if (options.fileFilter !== "all") {
    const duplicates = options.fileFilter === "duplicates";

    // Caption filter first, or this claims "No duplicates" when the caption filter hides them.
    if (options.filter !== "all") {
      return {
        icon: iconSearch,
        title: duplicates ? "No matching duplicates" : "No matching candidates",
        description: duplicates
          ? "Nothing in this folder is both flagged as a duplicate and matched by the caption filter."
          : "Nothing in this folder has a candidate waiting that the caption filter also keeps.",
        variant: "muted",
      };
    }

    return {
      icon: iconCircleCheck,
      title: duplicates ? "No duplicates" : "No candidates",
      description: duplicates
        ? "Nothing in this folder is flagged as a duplicate. Run find duplicates to check."
        : "Nothing in this folder has a candidate waiting. Run Process with ComfyUI to create some.",
      variant: "success",
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
