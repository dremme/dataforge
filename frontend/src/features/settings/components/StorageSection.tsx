import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatApiError } from "@/shared/api/http";
import { iconHardDrive, iconTrash2 } from "@/shared/icons";
import { formatCount, formatFileSize } from "@/shared/lib/format";
import type { ThumbnailCacheStats } from "@/shared/types";
import { fetchThumbnailCacheStats, settingsKeys } from "../api/settings";
import { useClearThumbnailCache } from "../hooks/useClearThumbnailCache";
import { SettingsActionButton } from "./SettingsActionButton";
import { SettingsGroup } from "./SettingsGroup";

interface StorageSectionProps {
  /** Measuring walks the whole cache, so it waits until the section is first shown. */
  visible: boolean;
  disabled: boolean;
  children: ReactNode;
}

export function StorageSection({ visible, disabled, children }: StorageSectionProps) {
  const queryClient = useQueryClient();
  const { clearing, clear } = useClearThumbnailCache();

  const statsQuery = useQuery({
    queryKey: settingsKeys.thumbnailCache,
    queryFn: ({ signal }) => fetchThumbnailCacheStats(signal),
    enabled: visible,
  });

  const handleClear = async () => {
    if (!statsQuery.data || !(await clear())) return;
    queryClient.setQueryData<ThumbnailCacheStats>(
      settingsKeys.thumbnailCache,
      (current) => current && { ...current, file_count: 0, size_bytes: 0 },
    );
  };

  const stats = statsQuery.data ?? null;
  const measuring = stats ? null : "Measuring...";

  return (
    <SettingsGroup
      title="Thumbnail cache"
      icon={iconHardDrive}
      hint="Recreated as you browse. Past the limit, the least recently used go first; 0 means no limit."
      action={
        <SettingsActionButton
          label="Clear cache"
          icon={iconTrash2}
          busy={clearing}
          disabled={disabled || !stats || stats.file_count === 0}
          onClick={() => void handleClear()}
        />
      }
    >
      {statsQuery.isError ? (
        <p className="dialog__error" role="alert">
          {formatApiError(statsQuery.error)}
        </p>
      ) : (
        <dl className="settings-stats" role="status">
          <div className="settings-stats__tile">
            <dt>Thumbnails</dt>
            <dd>{stats ? formatCount(stats.file_count) : measuring}</dd>
          </div>
          <div className="settings-stats__tile">
            <dt>On disk</dt>
            <dd>{stats ? formatFileSize(stats.size_bytes) : measuring}</dd>
          </div>
        </dl>
      )}
      {children}
    </SettingsGroup>
  );
}
