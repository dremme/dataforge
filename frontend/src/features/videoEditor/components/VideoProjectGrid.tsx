import { iconClapperboard } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";
import { SectionHeader } from "@/shared/ui/SectionHeader";
import { Tooltip } from "@/shared/ui/Tooltip";
import type { VideoProjectSummary } from "@/shared/types";
import { optionalThumbnailUrl } from "@/features/gallery/api/media";
import { useVideoProjectList } from "@/features/videoEditor/hooks/useVideoProjectList";
import { formatTimecode } from "@/features/videoEditor/lib/timeline";

interface VideoProjectGridProps {
  folderPath: string;
  /** The listing's fingerprint; a change re-reads the drafts, which the listing leaves out. */
  fingerprint: string;
  /** The gallery's search text; drafts whose name lacks it are left out, as folders are. */
  searchQuery: string;
  onOpen: (projectPath: string) => void;
}

/** The folder's saved editor drafts. Hidden while there are none. */
export function VideoProjectGrid({
  folderPath,
  fingerprint,
  searchQuery,
  onOpen,
}: VideoProjectGridProps) {
  const { data: projects = [] } = useVideoProjectList(folderPath, true, fingerprint);
  if (projects.length === 0) return null;

  const needle = searchQuery.trim().toLowerCase();
  const shown = needle
    ? projects.filter((project) => project.name.toLowerCase().includes(needle))
    : projects;

  return (
    <section className="folder-section video-project-section" aria-label="Video projects">
      <SectionHeader
        section="folder"
        icon={iconClapperboard}
        title="Video projects"
        count={shown.length}
        total={projects.length}
      />
      {shown.length > 0 && (
        <div className="video-project-grid">
          {shown.map((project) => (
            <VideoProjectCard key={project.path} project={project} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}

function VideoProjectCard({
  project,
  onOpen,
}: {
  project: VideoProjectSummary;
  onOpen: (projectPath: string) => void;
}) {
  const edited = new Date(project.updated_at);
  const hasEdited = !Number.isNaN(edited.getTime());
  const clips = `${project.clip_count} ${project.clip_count === 1 ? "clip" : "clips"}`;

  const tooltip = (
    <span className="video-project-card__tip">
      <span className="video-project-card__tip-name">{project.name}</span>
      <span>{fileName(project.path)}</span>
      {hasEdited && <span>Edited {edited.toLocaleString()}</span>}
    </span>
  );

  return (
    <Tooltip content={tooltip} className="video-project-grid__cell">
      <button
        type="button"
        className="video-project-card"
        onClick={() => onOpen(project.path)}
        aria-label={`Open the video project ${project.name} in the video editor`}
      >
        <span className="video-project-card__thumb" aria-hidden="true">
          {project.thumbnail_path && (
            <img src={optionalThumbnailUrl(project.thumbnail_path, 200)} alt="" loading="lazy" />
          )}
          <Icon icon={iconClapperboard} className="video-project-card__badge" />
        </span>
        <span className="video-project-card__body">
          <span className="video-project-card__name">{project.name}</span>
          <span className="video-project-card__meta">
            {formatTimecode(project.duration)} · {clips}
            {hasEdited ? ` · ${edited.toLocaleDateString()}` : ""}
          </span>
        </span>
      </button>
    </Tooltip>
  );
}

function fileName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")) + 1);
}
