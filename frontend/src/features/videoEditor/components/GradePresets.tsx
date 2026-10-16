import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatApiError } from "@/shared/api/http";
import type { ColorAdjust } from "@/shared/types";
import {
  deleteVideoProjectGrade,
  listVideoProjectGrades,
  saveVideoProjectGrade,
} from "@/features/videoEditor/api/videoProjects";

const GRADES_QUERY_KEY = ["video-project-grades"] as const;

interface GradePresetsProps {
  /** The grade a Save keeps; omitted where there is no one clip to save from. */
  current?: ColorAdjust;
  onApply: (adjust: ColorAdjust) => void;
}

/** Grades saved by name in any project, to give generated shots one consistent look. */
export function GradePresets({ current, onApply }: GradePresetsProps) {
  const queryClient = useQueryClient();
  const grades = useQuery({
    queryKey: GRADES_QUERY_KEY,
    queryFn: async () => (await listVideoProjectGrades()).grades,
  });
  const [chosen, setChosen] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = grades.data ?? [];
  const picked = list.find((grade) => grade.id === chosen);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: GRADES_QUERY_KEY });
      return true;
    } catch (caught) {
      setError(formatApiError(caught));
      return false;
    }
  };
  const save = async () => {
    const trimmed = name?.trim();
    if (!trimmed || !current) return;
    if (await run(() => saveVideoProjectGrade(trimmed, current))) setName(null);
  };

  return (
    <div className="video-editor__grades">
      <div className="video-editor__grades-row">
        <select
          aria-label="Saved grade"
          className="video-editor__grades-select"
          value={chosen}
          onChange={(event) => setChosen(event.target.value)}
          disabled={list.length === 0}
        >
          <option value="">{list.length ? "Saved grades..." : "No saved grades yet"}</option>
          {list.map((grade) => (
            <option key={grade.id} value={grade.id}>
              {grade.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="video-editor__text-btn"
          disabled={!picked}
          onClick={() => picked && onApply(picked.adjust)}
        >
          Apply
        </button>
        <button
          type="button"
          className="video-editor__text-btn"
          disabled={!picked}
          aria-label={picked ? `Delete grade ${picked.name}` : "Delete grade"}
          onClick={() =>
            picked && void run(() => deleteVideoProjectGrade(picked.id)).then(() => setChosen(""))
          }
        >
          Delete
        </button>
      </div>
      {current &&
        (name === null ? (
          <button type="button" className="video-editor__text-btn" onClick={() => setName("")}>
            Save this grade...
          </button>
        ) : (
          <div className="video-editor__grades-row">
            <input
              className="video-editor__grades-name"
              value={name}
              maxLength={60}
              placeholder="Grade name"
              aria-label="Grade name"
              autoFocus
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void save();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setName(null);
                }
              }}
            />
            <button
              type="button"
              className="video-editor__text-btn"
              disabled={!name.trim()}
              onClick={() => void save()}
            >
              Save
            </button>
          </div>
        ))}
      {error && <p className="video-editor__hint video-editor__hint--error">{error}</p>}
    </div>
  );
}
