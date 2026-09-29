import { useEffect, useState, type ReactNode } from "react";
import { formatApiError, isAbortError } from "@/shared/api/http";
import { iconHardDrive, iconTrash2 } from "@/shared/icons";
import { formatCount, formatFileSize } from "@/shared/lib/format";
import type { ThumbnailCacheStats } from "@/shared/types";
import { fetchThumbnailCacheStats } from "../api/settings";
import { useClearThumbnailCache } from "../hooks/useClearThumbnailCache";
import { SettingsActionButton } from "./SettingsActionButton";
import { SettingsGroup } from "./SettingsGroup";

type StatsState =
  | { status: "idle" }
  | { status: "failed"; message: string }
  | { status: "ready"; stats: ThumbnailCacheStats };

interface StorageSectionProps {
  /** Measuring walks the whole cache, so it waits until the section is first shown. */
  visible: boolean;
  disabled: boolean;
  children: ReactNode;
}

export function StorageSection({ visible, disabled, children }: StorageSectionProps) {
  const [state, setState] = useState<StatsState>({ status: "idle" });
  const { clearing, clear } = useClearThumbnailCache();
  const status = state.status;

  useEffect(() => {
    if (!visible || status !== "idle") return;
    const controller = new AbortController();
    fetchThumbnailCacheStats(controller.signal).then(
      (stats) => setState({ status: "ready", stats }),
      (error: unknown) => {
        if (isAbortError(error)) return;
        setState({ status: "failed", message: formatApiError(error) });
      },
    );
    return () => controller.abort();
  }, [visible, status]);

  const handleClear = async () => {
    if (state.status !== "ready" || !(await clear())) return;
    setState({ status: "ready", stats: { ...state.stats, file_count: 0, size_bytes: 0 } });
  };

  const stats = state.status === "ready" ? state.stats : null;
  const measuring = state.status === "idle" ? "Measuring..." : null;

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
      {state.status === "failed" ? (
        <p className="dialog__error" role="alert">
          {state.message}
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
