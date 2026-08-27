import { describe, expect, it } from "vitest";
import {
  iconCircleCheck,
  iconMessageDashed,
  iconImage,
  iconSearch,
  iconVideo,
} from "@/shared/icons";
import { getFilterEmptyState } from "./filters";

const baseOptions = {
  filter: "all" as const,
  mediaTypeFilter: "all" as const,
  fileFilter: "all" as const,
  searchQuery: "",
  hasFilterMatches: false,
  imageCount: 3,
  videoCount: 1,
};

describe("getFilterEmptyState", () => {
  it("describes active search misses", () => {
    const state = getFilterEmptyState({
      ...baseOptions,
      searchQuery: "sunset",
      hasFilterMatches: true,
    });

    expect(state.icon).toBe(iconSearch);
    expect(state.title).toBe("No search matches");
    expect(state.description).toContain("sunset");
    expect(state.variant).toBe("muted");
  });

  it("describes folders without videos", () => {
    const state = getFilterEmptyState({
      ...baseOptions,
      mediaTypeFilter: "video",
      videoCount: 0,
    });

    expect(state.icon).toBe(iconVideo);
    expect(state.title).toBe("No videos");
    expect(state.variant).toBe("muted");
  });

  it("describes folders without images", () => {
    const state = getFilterEmptyState({
      ...baseOptions,
      mediaTypeFilter: "image",
      imageCount: 0,
    });

    expect(state.icon).toBe(iconImage);
    expect(state.title).toBe("No images");
    expect(state.variant).toBe("muted");
  });

  it("celebrates when every file is captioned on the missing filter", () => {
    const state = getFilterEmptyState({
      ...baseOptions,
      filter: "uncaptioned",
    });

    expect(state.icon).toBe(iconCircleCheck);
    expect(state.title).toBe("All files captioned");
    expect(state.variant).toBe("success");
  });

  it("describes an empty captioned filter", () => {
    const state = getFilterEmptyState({
      ...baseOptions,
      filter: "captioned",
    });

    expect(state.icon).toBe(iconMessageDashed);
    expect(state.title).toBe("No captioned files");
    expect(state.variant).toBe("default");
  });

  it("celebrates a folder with no duplicates", () => {
    const state = getFilterEmptyState({
      ...baseOptions,
      fileFilter: "duplicates",
    });

    expect(state.icon).toBe(iconCircleCheck);
    expect(state.title).toBe("No duplicates");
    expect(state.variant).toBe("success");
  });

  // "No duplicates" would lie: the folder may have them, just none the caption filter keeps.
  it("blames the combination when duplicates and a caption filter are both active", () => {
    const state = getFilterEmptyState({
      ...baseOptions,
      fileFilter: "duplicates",
      filter: "uncaptioned",
    });

    expect(state.title).toBe("No matching duplicates");
    expect(state.description).toContain("caption filter");
    expect(state.variant).toBe("muted");
  });

  it("celebrates a folder with no candidates", () => {
    const state = getFilterEmptyState({
      ...baseOptions,
      fileFilter: "candidates",
    });

    expect(state.icon).toBe(iconCircleCheck);
    expect(state.title).toBe("No candidates");
    expect(state.variant).toBe("success");
  });

  it("blames the combination when candidates and a caption filter are both active", () => {
    const state = getFilterEmptyState({
      ...baseOptions,
      fileFilter: "candidates",
      filter: "uncaptioned",
    });

    expect(state.title).toBe("No matching candidates");
    expect(state.description).toContain("caption filter");
    expect(state.variant).toBe("muted");
  });

  it("reports a missing media type ahead of the file filter", () => {
    const state = getFilterEmptyState({
      ...baseOptions,
      fileFilter: "duplicates",
      mediaTypeFilter: "video",
      videoCount: 0,
    });

    expect(state.title).toBe("No videos");
  });

  it("falls back to a generic no-matches state", () => {
    const state = getFilterEmptyState({
      ...baseOptions,
      hasFilterMatches: true,
    });

    expect(state.title).toBe("No matches");
    expect(state.variant).toBe("muted");
  });

  it("treats active search in an empty folder as generic no-matches", () => {
    const state = getFilterEmptyState({
      ...baseOptions,
      imageCount: 0,
      videoCount: 0,
      searchQuery: "sunset",
      hasFilterMatches: false,
    });

    expect(state.title).toBe("No matches");
  });
});
