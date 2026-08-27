import { useCallback, useEffect, useMemo, useState } from "react";
import { countDuplicates } from "@/features/gallery/lib/duplicates";
import { getFilterEmptyState } from "@/features/gallery/lib/filters";
import { countCandidates } from "@/features/gallery/lib/candidateReview";
import {
  cacheGallerySessionQuery,
  readGallerySessionQuery,
} from "@/features/gallery/lib/sessionPreferences";
import {
  DEFAULT_SORT,
  applyFileFilter,
  applyItemFilter,
  applyMediaTypeFilter,
  countCaptioned,
  countIssues,
  countMediaType,
  filterBySearch,
  parseSortOption,
  processGalleryItems,
  type FileFilter,
  type ItemFilter,
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
  const [filter, setFilterState] = useState<ItemFilter>(() => readGallerySessionQuery().filter);
  const [mediaTypeFilter, setMediaTypeFilterState] = useState<MediaTypeFilter>(
    () => readGallerySessionQuery().mediaTypeFilter,
  );
  const [fileFilter, setFileFilterState] = useState<FileFilter>(
    () => readGallerySessionQuery().fileFilter,
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

  const setFilter = useCallback((value: ItemFilter) => {
    setFilterState(value);
    cacheGallerySessionQuery({ filter: value });
  }, []);

  const setMediaTypeFilter = useCallback((value: MediaTypeFilter) => {
    setMediaTypeFilterState(value);
    cacheGallerySessionQuery({ mediaTypeFilter: value });
  }, []);

  const setFileFilter = useCallback((value: FileFilter) => {
    setFileFilterState(value);
    cacheGallerySessionQuery({ fileFilter: value });
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

  const captionScopedItems = useMemo(() => applyItemFilter(items, filter), [items, filter]);

  const captionFilteredItems = useMemo(
    () => applyItemFilter(mediaTypeFilteredItems, filter),
    [mediaTypeFilteredItems, filter],
  );

  const filterMatchedItems = useMemo(
    () => applyFileFilter(captionFilteredItems, fileFilter),
    [captionFilteredItems, fileFilter],
  );

  const filteredItems = useMemo(
    () =>
      processGalleryItems(items, {
        filter,
        mediaTypeFilter,
        fileFilter,
        searchQuery,
        searchRegex,
        searchNames,
        sort,
      }),
    [items, filter, mediaTypeFilter, fileFilter, searchQuery, searchRegex, searchNames, sort],
  );

  const hasActiveSearch = searchQuery.trim().length > 0;
  const hasActiveFilters = filter !== "all" || mediaTypeFilter !== "all" || fileFilter !== "all";
  const captionedCount = useMemo(() => countCaptioned(items), [items]);

  // Each axis counts with the others applied, so a menu count is what picking it leaves.
  const captionFilterCountItems = useMemo(
    () =>
      filterBySearch(
        applyFileFilter(mediaTypeFilteredItems, fileFilter),
        searchQuery,
        searchRegex,
        searchNames,
      ),
    [mediaTypeFilteredItems, fileFilter, searchQuery, searchRegex, searchNames],
  );

  const mediaTypeFilterCountItems = useMemo(
    () =>
      filterBySearch(
        applyFileFilter(captionScopedItems, fileFilter),
        searchQuery,
        searchRegex,
        searchNames,
      ),
    [captionScopedItems, fileFilter, searchQuery, searchRegex, searchNames],
  );

  // Files-option counts: this axis off, the others on, so each number is what it leaves.
  const fileFilterCountItems = useMemo(
    () => filterBySearch(captionFilteredItems, searchQuery, searchRegex, searchNames),
    [captionFilteredItems, searchQuery, searchRegex, searchNames],
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

  const fileFilterCounts = useMemo(
    () =>
      ({
        all: fileFilterCountItems.length,
        duplicates: countDuplicates(fileFilterCountItems),
        candidates: countCandidates(fileFilterCountItems),
      }) as const,
    [fileFilterCountItems],
  );

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
        fileFilter,
        searchQuery,
        hasFilterMatches: filterMatchedItems.length > 0,
        imageCount: countMediaType(items, "image"),
        videoCount: countMediaType(items, "video"),
      }),
    [filterMatchedItems.length, filter, items, mediaTypeFilter, fileFilter, searchQuery],
  );

  return {
    filter,
    setFilter,
    mediaTypeFilter,
    setMediaTypeFilter,
    fileFilter,
    setFileFilter,
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
    fileFilterCounts,
    filterEmptyState,
  };
}
