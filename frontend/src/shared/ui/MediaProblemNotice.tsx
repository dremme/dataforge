import type { ReactNode } from "react";
import { iconTriangleAlert } from "@/shared/icons";
import {
  MEDIA_PROBLEM_EXPLANATIONS,
  MEDIA_PROBLEM_LABELS,
  type MediaProblemKind,
} from "@/shared/lib/mediaProblems";
import { Icon } from "@/shared/ui/Icon";

interface MediaProblemNoticeProps {
  problem: MediaProblemKind;
  onRetry: () => void;
  /** A way past the problem, such as a compatible copy; Retry alone when absent. */
  action?: ReactNode;
}

/** Laid over a media element that cannot play: what went wrong, and what can be done. */
export function MediaProblemNotice({ problem, onRetry, action }: MediaProblemNoticeProps) {
  return (
    <div className="media-problem" role="alert">
      <Icon icon={iconTriangleAlert} className="media-problem__icon" />
      <p className="media-problem__text">
        <strong>{MEDIA_PROBLEM_LABELS[problem]}.</strong> {MEDIA_PROBLEM_EXPLANATIONS[problem]}
      </p>
      <div className="media-problem__actions">
        <button type="button" className="media-problem__button" onClick={onRetry}>
          Retry
        </button>
        {action}
      </div>
    </div>
  );
}
