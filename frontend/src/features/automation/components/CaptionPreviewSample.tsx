import { diffCaption } from "@/features/automation/lib/captionDiff";

interface CaptionPreviewSampleProps {
  name: string;
  before: string;
  after?: string | null;
  error?: string | null;
}

export function CaptionPreviewSample({
  name,
  before,
  after = null,
  error,
}: CaptionPreviewSampleProps) {
  const diff = after === null ? null : diffCaption(before, after);

  return (
    <li className="caption-preview-sample">
      <span className="caption-preview-sample__name" title={name}>
        {name}
      </span>
      {diff && (
        <p className="caption-preview-sample__text">
          {before === after && <strong>Unchanged: </strong>}
          {diff.prefix}
          {diff.removed && <del className="caption-preview-sample__removed">{diff.removed}</del>}
          {diff.added && <ins className="caption-preview-sample__added">{diff.added}</ins>}
          {diff.suffix}
        </p>
      )}
      {error && <p className="dialog__error">{error}</p>}
    </li>
  );
}
