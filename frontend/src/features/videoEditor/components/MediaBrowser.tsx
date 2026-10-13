import { useMemo, useState } from "react";
import {
  iconCheck,
  iconClapperboard,
  iconFilm,
  iconImage,
  iconLayoutGrid,
  iconList,
  iconMusic,
  iconPlus,
  iconSearch,
  iconX,
} from "@/shared/icons";
import { formatApiError } from "@/shared/api/http";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";
import type { GalleryItem } from "@/shared/types";
import { AudioWaveform } from "@/features/gallery/components/AudioWaveform";
import { galleryItemThumbnailPreviewUrl } from "@/features/gallery/lib/thumbnail";
import { useVideoProjectList } from "@/features/videoEditor/hooks/useVideoProjectList";
import { editorMediaKind, type EditorMediaKind } from "@/features/videoEditor/lib/mediaKinds";
import { formatTimecode } from "@/features/videoEditor/lib/timeline";
import { SOURCE_DRAG_TYPE } from "./Timeline";
import { ToolButton } from "./ToolButton";

export type MediaView = "grid" | "list";

type MediaFilter = EditorMediaKind | "all";

const FILTERS: { kind: MediaFilter; label: string }[] = [
  { kind: "all", label: "All" },
  { kind: "video", label: "Video" },
  { kind: "image", label: "Image" },
  { kind: "audio", label: "Audio" },
];

const KIND_ICONS: Record<EditorMediaKind, typeof iconFilm> = {
  video: iconFilm,
  image: iconImage,
  audio: iconMusic,
};

interface MediaBrowserProps {
  tab: "media" | "projects";
  onTab: (tab: "media" | "projects") => void;
  folder: string;
  items: GalleryItem[];
  /** Files the timeline already uses, marked so the unused ones stand out. */
  usedPaths: Set<string>;
  view: MediaView;
  onView: (view: MediaView) => void;
  previewing: string | null;
  currentProjectPath: string | null;
  onPreview: (item: GalleryItem) => void;
  onAdd: (item: GalleryItem) => void;
  onOpenProject: (path: string) => void;
}

export function MediaBrowser({
  tab,
  onTab,
  folder,
  items,
  usedPaths,
  view,
  onView,
  previewing,
  currentProjectPath,
  onPreview,
  onAdd,
  onOpenProject,
}: MediaBrowserProps) {
  return (
    <aside className="video-editor__browser video-editor__pane" aria-label="Media and projects">
      <div className="video-editor__pane-header">
        <div className="video-editor__tabs" role="tablist" aria-label="Browser">
          {(["media", "projects"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={classNames(
                "video-editor__tab",
                tab === value && "video-editor__tab--active",
              )}
              onClick={() => onTab(value)}
            >
              {value === "media" ? "Media" : "Projects"}
            </button>
          ))}
        </div>
        {tab === "media" && (
          <ToolButton
            icon={view === "grid" ? iconList : iconLayoutGrid}
            label={view === "grid" ? "Show as a list" : "Show as tiles"}
            onClick={() => onView(view === "grid" ? "list" : "grid")}
          />
        )}
      </div>
      {tab === "media" ? (
        <MediaList
          items={items}
          usedPaths={usedPaths}
          view={view}
          previewing={previewing}
          onPreview={onPreview}
          onAdd={onAdd}
        />
      ) : (
        <ProjectList
          folder={folder}
          currentProjectPath={currentProjectPath}
          onOpen={onOpenProject}
        />
      )}
    </aside>
  );
}

function MediaList({
  items,
  usedPaths,
  view,
  previewing,
  onPreview,
  onAdd,
}: {
  items: GalleryItem[];
  usedPaths: Set<string>;
  view: MediaView;
  previewing: string | null;
  onPreview: (item: GalleryItem) => void;
  onAdd: (item: GalleryItem) => void;
}) {
  const [filter, setFilter] = useState<MediaFilter>("all");
  const [search, setSearch] = useState("");
  const usable = useMemo(
    () =>
      items.flatMap((item) => {
        const kind = editorMediaKind(item.name);
        return kind ? [{ item, kind }] : [];
      }),
    [items],
  );
  const counts = useMemo(() => {
    const result: Record<MediaFilter, number> = { all: 0, video: 0, image: 0, audio: 0 };
    for (const { kind } of usable) {
      result.all += 1;
      result[kind] += 1;
    }
    return result;
  }, [usable]);
  const needle = search.trim().toLowerCase();
  const shown = usable.filter(
    ({ item, kind }) =>
      (filter === "all" || kind === filter) && item.name.toLowerCase().includes(needle),
  );

  return (
    <div className="video-editor__browser-body">
      <div className="video-editor__browser-tools">
        <label className="video-editor__search">
          <Icon icon={iconSearch} />
          <input
            type="search"
            placeholder="Search filenames"
            aria-label="Search filenames"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button
              type="button"
              className="video-editor__icon-btn"
              aria-label="Clear the search"
              onClick={() => setSearch("")}
            >
              <Icon icon={iconX} />
            </button>
          )}
        </label>
        <div className="video-editor__filters" role="radiogroup" aria-label="Show">
          {FILTERS.map(({ kind, label }) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={filter === kind}
              className={classNames(
                "video-editor__filter",
                filter === kind && "video-editor__filter--on",
              )}
              onClick={() => setFilter(kind)}
              disabled={kind !== "all" && counts[kind] === 0}
            >
              {label}
              <span className="video-editor__filter-count">{counts[kind]}</span>
            </button>
          ))}
        </div>
      </div>
      <ul
        className={classNames("video-editor__media-list", `video-editor__media-list--${view}`)}
        data-scroll-lock-allow
      >
        {shown.map(({ item, kind }) => (
          <MediaRow
            key={item.path}
            item={item}
            kind={kind}
            used={usedPaths.has(item.path)}
            active={previewing === item.path}
            onPreview={() => onPreview(item)}
            onAdd={() => onAdd(item)}
          />
        ))}
      </ul>
      {shown.length === 0 && (
        <div className="video-editor__empty">
          <Icon icon={usable.length === 0 ? iconFilm : iconSearch} />
          <p>
            {usable.length === 0
              ? "This folder has no MP4, MOV, M4V, image or WAV/MP3 files."
              : "Nothing matches the search and filter."}
          </p>
        </div>
      )}
      {shown.length > 0 && (
        <p className="video-editor__browser-hint">
          Click to preview, drag onto a track, or press + to add at the playhead.
        </p>
      )}
    </div>
  );
}

function MediaRow({
  item,
  kind,
  used,
  active,
  onPreview,
  onAdd,
}: {
  item: GalleryItem;
  kind: EditorMediaKind;
  used: boolean;
  active: boolean;
  onPreview: () => void;
  onAdd: () => void;
}) {
  const thumbnail = galleryItemThumbnailPreviewUrl(item);
  return (
    <li
      className={classNames(
        "video-editor__media",
        `video-editor__media--${kind}`,
        active && "video-editor__media--active",
      )}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(SOURCE_DRAG_TYPE, item.path);
        event.dataTransfer.effectAllowed = "copy";
      }}
    >
      <button
        type="button"
        className="video-editor__media-open"
        onClick={onPreview}
        aria-label={`Preview ${item.name}${used ? ", used on the timeline" : ""}`}
      >
        <span className="video-editor__media-thumb">
          {kind === "audio" ? (
            <AudioWaveform src={thumbnail} className="video-editor__media-wave" />
          ) : (
            <img src={thumbnail} alt="" loading="lazy" draggable={false} />
          )}
          <span className="video-editor__media-kind" aria-hidden="true">
            <Icon icon={KIND_ICONS[kind]} />
          </span>
          {kind !== "image" && (
            <span className="video-editor__media-duration">
              {item.duration ? formatTimecode(item.duration) : "--:--"}
            </span>
          )}
          {used && (
            <span className="video-editor__media-used" title="Used on the timeline">
              <Icon icon={iconCheck} />
            </span>
          )}
        </span>
        <span className="video-editor__media-text">
          <span className="video-editor__media-name" title={item.name}>
            {item.name}
          </span>
          <span className="video-editor__media-meta">
            {kind === "image" ? "Still" : item.duration ? formatTimecode(item.duration) : "--:--"}
            {used && " · on timeline"}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="video-editor__media-add"
        onClick={onAdd}
        aria-label={`Add ${item.name} to the timeline`}
        title="Add at the playhead"
      >
        <Icon icon={iconPlus} />
      </button>
    </li>
  );
}

function ProjectList({
  folder,
  currentProjectPath,
  onOpen,
}: {
  folder: string;
  currentProjectPath: string | null;
  onOpen: (path: string) => void;
}) {
  const query = useVideoProjectList(folder);
  return (
    <div className="video-editor__browser-body">
      <p className="video-editor__browser-note">
        Drafts in this folder save as you edit. Open one to delete it from its menu.
      </p>
      <ul className="video-editor__project-list" data-scroll-lock-allow>
        {(query.data ?? []).map((summary) => {
          const open = summary.path === currentProjectPath;
          return (
            <li key={summary.path}>
              <button
                type="button"
                className={classNames(
                  "video-editor__project",
                  open && "video-editor__project--open",
                )}
                onClick={() => onOpen(summary.path)}
                disabled={open}
                aria-label={`Open ${summary.name}`}
              >
                <span className="video-editor__project-icon" aria-hidden="true">
                  <Icon icon={iconClapperboard} />
                </span>
                <span className="video-editor__media-text">
                  <span className="video-editor__media-name">{summary.name}</span>
                  <span className="video-editor__media-meta">
                    {formatTimecode(summary.duration)} · {summary.clip_count} clips
                  </span>
                  <span className="video-editor__media-meta">
                    {new Date(summary.updated_at).toLocaleString()}
                  </span>
                </span>
                {open && <span className="video-editor__project-badge">Open</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {query.isSuccess && query.data.length === 0 && (
        <div className="video-editor__empty">
          <Icon icon={iconClapperboard} />
          <p>No saved drafts in this folder yet.</p>
        </div>
      )}
      {query.isError && (
        <div className="video-editor__empty">
          <p>{formatApiError(query.error)}</p>
        </div>
      )}
    </div>
  );
}
