import { useCallback, useEffect, useMemo, useState } from "react";
import { countDuplicates } from "@/features/gallery/lib/duplicates";
import { getFilterEmptyState } from "@/features/gallery/lib/filters";
import {
  cacheGallerySessionQuery,
  readGallerySessionQuery,
} from "@/features/gallery/lib/sessionPreferences";
import {
  DEFAULT_SORT,
  applyDuplicateFilter,
  applyItemFilter,
  applyMediaTypeFilter,
  countCaptioned,
  countIssues,
  countMediaType,
  filterBySearch,
  parseSortOption,
  processGalleryItems,
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
  const [duplicatesOnly, setDuplicatesOnlyState] = useState(
    () => readGallerySessionQuery().duplicatesOnly,
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

  const setDuplicatesOnly = useCallback((value: boolean) => {
    setDuplicatesOnlyState(value);
    cacheGallerySessionQuery({ duplicatesOnly: value });
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

  /** Everything the filters keep, before the search narrows it further. */
  const filterMatchedItems = useMemo(
    () => applyDuplicateFilter(captionFilteredItems, duplicatesOnly),
    [captionFilteredItems, duplicatesOnly],
  );

  const filteredItems = useMemo(
    () =>
      processGalleryItems(items, {
        filter,
        mediaTypeFilter,
        duplicatesOnly,
        searchQuery,
        searchRegex,
        searchNames,
        sort,
      }),
    [items, filter, mediaTypeFilter, duplicatesOnly, searchQuery, searchRegex, searchNames, sort],
  );

  const hasActiveSearch = searchQuery.trim().length > 0;
  const hasActiveFilters = filter !== "all" || mediaTypeFilter !== "all" || duplicatesOnly;
  const captionedCount = useMemo(() => countCaptioned(items), [items]);

  // Each axis is counted with every *other* axis applied, so a count in the menu always
  // equals what picking it would leave on screen. Miss one and the numbers quietly lie.
  const captionFilterCountItems = useMemo(
    () =>
      filterBySearch(
        applyDuplicateFilter(mediaTypeFilteredItems, duplicatesOnly),
        searchQuery,
        searchRegex,
        searchNames,
      ),
    [mediaTypeFilteredItems, duplicatesOnly, searchQuery, searchRegex, searchNames],
  );

  const mediaTypeFilterCountItems = useMemo(
    () =>
      filterBySearch(
        applyDuplicateFilter(captionScopedItems, duplicatesOnly),
        searchQuery,
        searchRegex,
        searchNames,
      ),
    [captionScopedItems, duplicatesOnly, searchQuery, searchRegex, searchNames],
  );

  // Deliberately not duplicate-scoped: this is the count on the toggle itself, so it has to
  // say what turning it on would find, which means measuring with it off.
  const duplicateFilterCountItems = useMemo(
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

  // Files, not groups: this count sits beside the others in the filter menu and says how
  // many items the filter would leave on screen.
  const duplicateCount = useMemo(
    () => countDuplicates(duplicateFilterCountItems),
    [duplicateFilterCountItems],
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
        duplicatesOnly,
        searchQuery,
        hasFilterMatches: filterMatchedItems.length > 0,
        imageCount: countMediaType(items, "image"),
        videoCount: countMediaType(items, "video"),
      }),
    [filterMatchedItems.length, filter, items, mediaTypeFilter, duplicatesOnly, searchQuery],
  );

  return {
    filter,
    setFilter,
    mediaTypeFilter,
    setMediaTypeFilter,
    duplicatesOnly,
    setDuplicatesOnly,
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
    duplicateCount,
    filterEmptyState,
  };
}
