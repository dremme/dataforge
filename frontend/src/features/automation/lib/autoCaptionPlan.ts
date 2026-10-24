import type { AutoCaptionPreviewResponse } from "@/shared/types";

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** One line on what a run will do with each caption in scope, and what it leaves alone. */
export function autoCaptionPlan(preview: AutoCaptionPreviewResponse): string {
  const work = [
    preview.drafts > 0 && count(preview.drafts, "draft to expand", "drafts to expand"),
    preview.from_scratch > 0 &&
      count(
        preview.from_scratch,
        "caption to write from scratch",
        "captions to write from scratch",
      ),
  ].filter(Boolean);
  const skipped = [
    preview.long_enough > 0 &&
      count(preview.long_enough, "caption already long enough", "captions already long enough"),
    preview.unreadable > 0 &&
      count(preview.unreadable, "unreadable caption", "unreadable captions"),
  ].filter(Boolean);

  const plan = work.length > 0 ? `${work.join(", ")}.` : "Nothing to caption.";
  return skipped.length > 0 ? `${plan} Left alone: ${skipped.join(", ")}.` : plan;
}
