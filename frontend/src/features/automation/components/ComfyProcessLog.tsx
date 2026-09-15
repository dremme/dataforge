import { useLayoutEffect, useRef, useState } from "react";
import { useComfyProcessLogs } from "@/features/automation/hooks/useComfyProcessLogs";
import { shouldStickToBottom } from "@/features/automation/lib/comfyProcessLog";
import { iconChevronDown } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";
import type { Job } from "@/shared/types";

interface ComfyProcessLogProps {
  job: Job | null;
}

/** ComfyUI's console while it renders, which is the only sign of life a long prompt gives. */
export function ComfyProcessLog({ job }: ComfyProcessLogProps) {
  const logs = useComfyProcessLogs(job);
  const [expanded, setExpanded] = useState(true);
  const outputRef = useRef<HTMLDivElement>(null);
  // Follows new output until the reader scrolls up, and again once they scroll back down.
  const pinnedRef = useRef(true);

  const lines = logs?.lines ?? [];

  // Keyed on the response, not on `lines`: the `?? []` fallback is a fresh array every render.
  useLayoutEffect(() => {
    const output = outputRef.current;
    if (!output || !pinnedRef.current) return;
    output.scrollTop = output.scrollHeight;
  }, [logs, expanded]);

  if (!logs) return null;

  return (
    <div className="comfy-process-log">
      <button
        type="button"
        className="comfy-process-log__toggle"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
      >
        <Icon
          icon={iconChevronDown}
          className={classNames(
            "comfy-process-log__toggle-icon",
            expanded && "comfy-process-log__toggle-icon--open",
          )}
        />
        <span className="comfy-process-log__label">ComfyUI output</span>
      </button>

      {expanded && (
        <div className="comfy-process-log__panel">
          {!logs.available && (
            <p className="comfy-process-log__note">
              ComfyUI is not reporting its output. The job is unaffected.
            </p>
          )}

          {logs.available && lines.length === 0 && (
            <p className="comfy-process-log__note">Waiting for ComfyUI output...</p>
          )}

          {lines.length > 0 && (
            // No aria-live and no role="log": this repaints every second, and a polite region
            // queues rather than drops, so a screen reader would fall behind and never catch up.
            <div
              ref={outputRef}
              className="comfy-process-log__output"
              role="region"
              aria-label="ComfyUI output"
              tabIndex={0}
              data-scroll-lock-allow
              onScroll={(event) => {
                const output = event.currentTarget;
                pinnedRef.current = shouldStickToBottom(
                  output.scrollTop,
                  output.scrollHeight,
                  output.clientHeight,
                );
              }}
            >
              {/* One text node, not a line each: 200 keyless elements every poll is pure churn. */}
              <pre className="comfy-process-log__text">{lines.join("\n")}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
