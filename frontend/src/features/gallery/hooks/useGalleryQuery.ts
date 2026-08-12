import { useCallback, useEffect, useMemo, useState } from "react";
import { getFilterEmptyState } from "@/features/gallery/lib/filters";
import {
  cacheGallerySessionQuery,
  readGallerySessionQuery,
} from "@/features/gallery/lib/sessionPreferences";
import {
  DEFAULT_SORT,
  applyCaptionFilter,
  applyMediaTypeFilter,
  countCaptioned,
  countIssues,
  countMediaType,
  filterBySearch,
  parseSortOption,
  processGalleryItems,
  type CaptionFilter,
  type MediaTypeFilter,
  type SortOption,
} from "@/features/gallery/lib/query";
import type { GalleryItem } from "@/shared/types";
import {
  loadUiSettings,
  readCachedSortPreference,
  updateUiSettings,
} from "@/shared/preferences/uiPreferences";

export function useGalleryQuery(items: GalleryItem[]) {
  const [filter, setFilterState] = useState<CaptionFilter>(() => readGallerySessionQuery().filter);
  const [mediaTypeFilter, setMediaTypeFilterState] = useState<MediaTypeFilter>(
    () => readGallerySessionQuery().mediaTypeFilter,
  );
  const [searchQuery, setSearchQueryState] = useState(() => readGallerySessionQuery().searchQuery);
  const [searchRegex, setSearchRegexState] = useState(() => readGallerySessionQuery().searchRegex);
  const [searchNames, setSearchNamesState] = useState(() => readGallerySessionQuery().searchNames);
  const [sort, setSortState] = useState<SortOption>(() =>
    parseSortOption(readCachedSortPreference() ?? DEFAULT_SORT),
  );

  useEffect(() => {
    let cancelled = false;

    loadUiSettings().then((settings) => {
      if (!cancelled) {
        setSortState(parseSortOption(settings.sort || DEFAULT_SORT));
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const setFilter = useCallback((value: CaptionFilter) => {
    setFilterState(value);
    cacheGallerySessionQuery({ filter: value });
  }, []);

  const setMediaTypeFilter = useCallback((value: MediaTypeFilter) => {
    setMediaTypeFilterState(value);
    cacheGallerySessionQuery({ mediaTypeFilter: value });
  }, []);

  const setSearchQuery = useCallback((value: string) => {
    setSearchQueryState(value);
    cacheGallerySessionQuery({ searchQuery: value });
  }, []);

  const setSearchRegex = useCallback((value: boolean) => {
    setSearchRegexState(value);
    cacheGallerySessionQuery({ searchRegex: value });
  }, []);

  const setSearchNames = useCallback((value: boolean) => {
    setSearchNamesState(value);
    cacheGallerySessionQuery({ searchNames: value });
  }, []);

  const setSort = useCallback((value: SortOption) => {
    setSortState(value);
    updateUiSettings({ sort: value }).catch(() => {
      // UI already reflects the choice; ignore persistence failures.
    });
  }, []);

  const mediaTypeFilteredItems = useMemo(
    () => applyMediaTypeFilter(items, mediaTypeFilter),
    [items, mediaTypeFilter],
  );

  const captionScopedItems = useMemo(() => applyCaptionFilter(items, filter), [items, filter]);

  const captionFilteredItems = useMemo(
    () => applyCaptionFilter(mediaTypeFilteredItems, filter),
    [mediaTypeFilteredItems, filter],
  );

  const filteredItems = useMemo(
    () =>
      processGalleryItems(items, {
        filter,
        mediaTypeFilter,
        searchQuery,
        searchRegex,
        searchNames,
        sort,
      }),
    [items, filter, mediaTypeFilter, searchQuery, searchRegex, searchNames, sort],
  );

  const hasActiveSearch = searchQuery.trim().length > 0;
  const hasActiveFilters = filter !== "all" || mediaTypeFilter !== "all";
  const captionedCount = useMemo(() => countCaptioned(items), [items]);

  const captionFilterCountItems = useMemo(
    () => filterBySearch(mediaTypeFilteredItems, searchQuery, searchRegex, searchNames),
    [mediaTypeFilteredItems, searchQuery, searchRegex, searchNames],
  );

  const mediaTypeFilterCountItems = useMemo(
    () => filterBySearch(captionScopedItems, searchQuery, searchRegex, searchNames),
    [captionScopedItems, searchQuery, searchRegex, searchNames],
  );

  const filterCounts = useMemo(() => {
    const captioned = countCaptioned(captionFilterCountItems);
    const issue = countIssues(captionFilterCountItems);
    return {
      all: captionFilterCountItems.length,
      captioned,
      issue,
      uncaptioned: captionFilterCountItems.length - captioned,
    } as const;
  }, [captionFilterCountItems]);

  const mediaTypeFilterCounts = useMemo(() => {
    const images = countMediaType(mediaTypeFilterCountItems, "image");
    const videos = countMediaType(mediaTypeFilterCountItems, "video");
    return {
      all: mediaTypeFilterCountItems.length,
      image: images,
      video: videos,
    } as const;
  }, [mediaTypeFilterCountItems]);

  const filterEmptyState = useMemo(
    () =>
      getFilterEmptyState({
        filter,
        mediaTypeFilter,
        searchQuery,
        hasFilterMatches: captionFilteredItems.length > 0,
        imageCount: countMediaType(items, "image"),
        videoCount: countMediaType(items, "video"),
      }),
    [captionFilteredItems.length, filter, items, mediaTypeFilter, searchQuery],
  );

  return {
    filter,
    setFilter,
    mediaTypeFilter,
    setMediaTypeFilter,
    searchQuery,
    searchRegex,
    searchNames,
    setSearchQuery,
    setSearchRegex,
    setSearchNames,
    sort,
    setSort,
    filteredItems,
    hasActiveSearch,
    hasActiveFilters,
    captionedCount,
    filterCounts,
    mediaTypeFilterCounts,
    filterEmptyState,
  };
}
