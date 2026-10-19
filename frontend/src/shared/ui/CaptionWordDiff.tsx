import { useMemo, type ReactNode } from "react";
import { diffCaptionWords, type CaptionDiffSegment } from "@/shared/lib/captionWordDiff";
import { classNames } from "@/shared/lib/classNames";

export type CaptionDiffLayout = "inline" | "split";

interface CaptionWordDiffProps {
  before: string;
  after: string;
  /** `split` puts `before` and `after` in two columns, each marking only its own side. */
  layout?: CaptionDiffLayout;
  className?: string;
}

/** `before` with the words `after` drops struck through and the words it adds highlighted. */
export function CaptionWordDiff({
  before,
  after,
  layout = "inline",
  className,
}: CaptionWordDiffProps) {
  const segments = useMemo(() => diffCaptionWords(before, after), [before, after]);
  return <CaptionDiffView segments={segments} layout={layout} className={className} />;
}

interface CaptionDiffViewProps {
  segments: CaptionDiffSegment[];
  layout?: CaptionDiffLayout;
  /** Split only: shown in a side that has no text, so it does not read as a gap. */
  emptySideLabel?: string;
  className?: string;
}

/** Renders segments already computed, for callers that also read them (word counts). */
export function CaptionDiffView({
  segments,
  layout = "inline",
  emptySideLabel,
  className,
}: CaptionDiffViewProps) {
  if (layout === "split") {
    return (
      <div className={classNames("caption-diff-split", className)}>
        <SplitSide segments={segments} omit="added" emptyLabel={emptySideLabel} />
        <SplitSide segments={segments} omit="removed" emptyLabel={emptySideLabel} />
      </div>
    );
  }

  return <p className={classNames("caption-diff", className)}>{renderSegments(segments)}</p>;
}

function SplitSide({
  segments,
  omit,
  emptyLabel,
}: {
  segments: CaptionDiffSegment[];
  omit: "removed" | "added";
  emptyLabel?: string;
}) {
  const empty = segments.every((segment) => segment.kind === omit || !segment.text.trim());
  // Nothing shared: marking every word adds noise once the side itself says what it is.
  const unrelated = !segments.some((segment) => segment.kind === "same" && segment.text.trim());
  return (
    <p
      className={classNames(
        "caption-diff",
        "caption-diff-split__side",
        `caption-diff-split__side--${omit === "added" ? "before" : "after"}`,
      )}
    >
      {empty && emptyLabel ? (
        <span className="caption-diff-split__empty">{emptyLabel}</span>
      ) : unrelated ? (
        segments
          .filter((segment) => segment.kind !== omit)
          .map((segment) => segment.text)
          .join("")
      ) : (
        renderSegments(segments, omit)
      )}
    </p>
  );
}

function renderSegments(segments: CaptionDiffSegment[], omit?: "removed" | "added"): ReactNode[] {
  return segments.map((segment, index) => {
    if (segment.kind === omit) return null;
    if (segment.kind === "removed") {
      return (
        <del key={index} className="caption-diff__removed">
          {segment.text}
        </del>
      );
    }
    if (segment.kind === "added") {
      return (
        <ins key={index} className="caption-diff__added">
          {segment.text}
        </ins>
      );
    }
    return segment.text;
  });
}
