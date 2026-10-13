import { useState } from "react";
import { iconTriangleAlert } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";
import type { GalleryItem, VideoProjectSourceStatus } from "@/shared/types";
import { editorMediaKind } from "@/features/videoEditor/lib/mediaKinds";
import type { Project } from "@/features/videoEditor/lib/timeline";

interface SourceIssuesProps {
  project: Project;
  statuses: VideoProjectSourceStatus[];
  items: GalleryItem[];
  busy: boolean;
  onRelink: (sourceId: string, item: GalleryItem) => void;
  onAccept: (sourceId: string) => void;
}

/** Sources the timeline uses that are gone or changed, each with the way to resolve it. */
export function SourceIssues({
  project,
  statuses,
  items,
  busy,
  onRelink,
  onAccept,
}: SourceIssuesProps) {
  const used = new Set(project.clips.map((clip) => clip.source_id).filter(Boolean));
  const issues = statuses.filter((status) => status.state !== "ok" && used.has(status.source_id));
  if (issues.length === 0) return null;
  return (
    <div className="video-editor__issues" role="alert">
      <Icon icon={iconTriangleAlert} />
      <div className="video-editor__issues-list">
        <p className="video-editor__issues-title">
          {issues.length === 1
            ? "A source needs attention"
            : `${issues.length} sources need attention`}
          . Export stays off until each is resolved; nothing is substituted on its own.
        </p>
        {issues.map((status) => {
          const source = project.sources.find((item) => item.id === status.source_id);
          if (!source) return null;
          return (
            <SourceIssue
              key={status.source_id}
              name={source.name}
              kind={source.kind}
              status={status}
              items={items}
              busy={busy}
              onRelink={(item) => onRelink(status.source_id, item)}
              onAccept={() => onAccept(status.source_id)}
            />
          );
        })}
      </div>
    </div>
  );
}

function SourceIssue({
  name,
  kind,
  status,
  items,
  busy,
  onRelink,
  onAccept,
}: {
  name: string;
  kind: string;
  status: VideoProjectSourceStatus;
  items: GalleryItem[];
  busy: boolean;
  onRelink: (item: GalleryItem) => void;
  onAccept: () => void;
}) {
  const candidates = items.filter((item) => editorMediaKind(item.name) === kind);
  const [choice, setChoice] = useState("");
  return (
    <div className="video-editor__issue">
      <span>
        <strong>{name}</strong>{" "}
        {status.state === "missing"
          ? "is missing from this folder."
          : "has changed since it was added (size or date differ)."}
      </span>
      {status.state === "changed" && (
        <button type="button" className="video-editor__text-btn" onClick={onAccept} disabled={busy}>
          Use the changed file
        </button>
      )}
      <span className="video-editor__relink">
        <select
          aria-label={`Replacement for ${name}`}
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
          disabled={busy || candidates.length === 0}
        >
          <option value="">
            {candidates.length ? "Relink to..." : `No other ${kind} files here`}
          </option>
          {candidates.map((item) => (
            <option key={item.path} value={item.path}>
              {item.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="video-editor__text-btn"
          disabled={busy || !choice}
          onClick={() => {
            const item = candidates.find((candidate) => candidate.path === choice);
            if (item) onRelink(item);
          }}
        >
          Relink
        </button>
      </span>
    </div>
  );
}
