import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_FEEDBACK_MS = 2000;

export function useCopyFeedback(feedbackMs = DEFAULT_FEEDBACK_MS) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const copyText = useCallback(
    async (text: string) => {
      if (text.length === 0) return false;

      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      try {
        await navigator.clipboard.writeText(text);
        setCopyState("copied");
      } catch {
        setCopyState("error");
        return false;
      }

      timerRef.current = setTimeout(() => {
        setCopyState("idle");
        timerRef.current = null;
      }, feedbackMs);

      return true;
    },
    [feedbackMs],
  );

  const copyLabel = copyState === "copied" ? "Copied!" : copyState === "error" ? "Failed!" : "Copy";

  return { copyState, copyLabel, copyText };
}
