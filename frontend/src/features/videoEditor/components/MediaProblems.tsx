import { Tooltip } from "@/shared/ui/Tooltip";
import { iconLoader2, iconTriangleAlert } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";
import type { MediaProblem } from "@/features/videoEditor/lib/previewEngine";
import { MEDIA_PROBLEM_EXPLANATIONS } from "@/shared/lib/mediaProblems";
import type { Project } from "@/features/videoEditor/lib/timeline";

interface MediaProblemsProps {
  project: Project;
  problems: MediaProblem[];
  /** Sources whose H.264 copy is being made. */
  converting: ReadonlySet<string>;
  onRetry: (sourceId: string) => void;
  onConvert: (sourceId: string) => void;
}

/** Sources the preview cannot play, each named with why and what can be done about it. */
export function MediaProblems({
  project,
  problems,
  converting,
  onRetry,
  onConvert,
}: MediaProblemsProps) {
  const used = new Set(project.clips.map((clip) => clip.source_id));
  const shown = problems.filter((problem) => used.has(problem.sourceId));
  if (shown.length === 0) return null;
  return (
    <div className="video-editor__issues video-editor__issues--preview" role="alert">
      <Icon icon={iconTriangleAlert} />
      <div className="video-editor__issues-list">
        <p className="video-editor__issues-title">
          {shown.length === 1
            ? "A source cannot be previewed"
            : `${shown.length} sources cannot be previewed`}
          . The preview shows a marked box; the export reads the files itself.
        </p>
        {shown.map((problem) => {
          const source = project.sources.find((item) => item.id === problem.sourceId);
          if (!source) return null;
          const busy = converting.has(problem.sourceId);
          return (
            <div key={problem.sourceId} className="video-editor__issue">
              <span>
                <strong>{source.name}</strong> {MEDIA_PROBLEM_EXPLANATIONS[problem.kind]}
              </span>
              <button
                type="button"
                className="video-editor__text-btn"
                onClick={() => onRetry(problem.sourceId)}
                disabled={busy}
              >
                Retry
              </button>
              {source.kind === "video" && problem.kind !== "network" && (
                <Tooltip content="Writes an H.264 copy beside the file and relinks this project to it">
                  <button
                    type="button"
                    className="video-editor__text-btn"
                    onClick={() => onConvert(problem.sourceId)}
                    disabled={busy}
                  >
                    {busy ? (
                      <>
                        <Icon icon={iconLoader2} spin /> Making a copy...
                      </>
                    ) : (
                      "Use an H.264 copy"
                    )}
                  </button>
                </Tooltip>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
