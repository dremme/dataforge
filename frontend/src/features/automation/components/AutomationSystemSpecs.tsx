import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { iconCpu, iconDot, iconGpu, iconMemoryStick } from "@/shared/icons";
import { useSystemSpecs } from "@/features/automation/hooks/useSystemSpecs";
import { classNames } from "@/shared/lib/classNames";
import { formatBytes, formatBytesValue } from "@/shared/lib/format";
import { Icon } from "@/shared/ui/Icon";

/** Load or memory share (percent) at or above which figures and bars turn yellow, then red. */
const USAGE_WARNING_PERCENT = 75;
const USAGE_DANGER_PERCENT = 90;

type UsageLevel = "normal" | "warning" | "danger";

function usageLevel(percent: number): UsageLevel {
  if (percent >= USAGE_DANGER_PERCENT) return "danger";
  if (percent >= USAGE_WARNING_PERCENT) return "warning";
  return "normal";
}

function memoryPercent(usedBytes: number, totalBytes: number): number {
  return totalBytes > 0 ? (100 * usedBytes) / totalBytes : 0;
}

/** Modifier class for a level, or `undefined` at normal usage. */
function levelClass(base: string, level: UsageLevel): string | undefined {
  return level === "normal" ? undefined : `${base}--${level}`;
}

export interface AutomationSystemSpecsProps {
  /** Matches the aria-controls of the toggle button in the automation header. */
  id: string;
  open: boolean;
  /** Refreshes quickly while a job runs so its load is visible. */
  jobActive?: boolean;
}

/** Collapsible CPU / RAM / GPU readout under the automation header. */
export function AutomationSystemSpecs({ id, open, jobActive = false }: AutomationSystemSpecsProps) {
  // A collapsed panel shows nothing, so it has no reason to poll fast.
  const specs = useSystemSpecs(open && jobActive);
  if (!specs) return null;

  const { gpu_name, gpu_memory_bytes, gpu_memory_used_bytes, gpu_load_percent } = specs;
  const hasGpu = specs.gpu_available && gpu_name !== null;

  return (
    <div
      id={id}
      className={classNames("automation__specs-panel", open && "automation__specs-panel--open")}
    >
      <div className="automation__specs-panel-inner">
        <div className="automation__specs" role="region" aria-label="System specifications">
          <Spec
            icon={iconCpu}
            meter={
              specs.cpu_usage_percent != null && {
                label: "CPU load",
                percent: specs.cpu_usage_percent,
              }
            }
          >
            {specs.cpu_name}
            <span className="automation__spec-detail">
              <Icon icon={iconDot} className="app-icon--dot" />
              {specs.cpu_cores} cores
            </span>
            {specs.cpu_usage_percent != null && (
              <LoadDetail percent={specs.cpu_usage_percent} title="CPU usage" />
            )}
          </Spec>

          <SpecDivider />

          <Spec
            icon={iconMemoryStick}
            meter={
              specs.memory_total_bytes > 0 && {
                label: "RAM usage",
                percent: memoryPercent(specs.memory_used_bytes, specs.memory_total_bytes),
              }
            }
          >
            RAM
            <MemoryDetail
              usedBytes={specs.memory_used_bytes}
              totalBytes={specs.memory_total_bytes}
              title="RAM used / total"
            />
          </Spec>

          <SpecDivider />

          <Spec
            icon={iconGpu}
            meter={
              hasGpu && gpu_load_percent != null && { label: "GPU load", percent: gpu_load_percent }
            }
          >
            {hasGpu ? (
              <>
                {gpu_name}
                {gpu_memory_bytes != null &&
                  (gpu_memory_used_bytes != null ? (
                    <MemoryDetail
                      usedBytes={gpu_memory_used_bytes}
                      totalBytes={gpu_memory_bytes}
                      title="VRAM used / total"
                    />
                  ) : (
                    <span className="automation__spec-detail" title="VRAM total">
                      <Icon icon={iconDot} className="app-icon--dot" />
                      {formatBytes(gpu_memory_bytes)}
                    </span>
                  ))}
                {gpu_load_percent != null && (
                  <LoadDetail percent={gpu_load_percent} title="GPU load" />
                )}
              </>
            ) : (
              <span className="automation__spec-detail">No GPU</span>
            )}
          </Spec>
        </div>
      </div>
    </div>
  );
}

interface SpecMeter {
  label: string;
  percent: number;
}

interface SpecProps {
  icon: LucideIcon;
  /** Bar under the readout; `false` keeps an empty track so the row stays aligned. */
  meter: SpecMeter | false;
  children: ReactNode;
}

function Spec({ icon, meter, children }: SpecProps) {
  return (
    <span className="automation__spec">
      <span className="automation__spec-row">
        <Icon icon={icon} className="automation__spec-icon" />
        <span className="automation__spec-label">{children}</span>
      </span>
      {meter ? (
        <SpecMeterBar {...meter} />
      ) : (
        <span className="automation__spec-meter automation__spec-meter--empty" aria-hidden="true" />
      )}
    </span>
  );
}

function SpecMeterBar({ label, percent }: SpecMeter) {
  const clamped = Math.min(100, Math.max(0, percent));
  const rounded = Math.round(clamped);
  return (
    <span
      className="automation__spec-meter"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={rounded}
      aria-valuetext={`${rounded}%`}
    >
      <span
        className={classNames(
          "automation__spec-meter-fill",
          levelClass("automation__spec-meter-fill", usageLevel(rounded)),
        )}
        style={{ width: `${clamped}%` }}
      />
    </span>
  );
}

function LoadDetail({ percent, title }: { percent: number; title: string }) {
  return (
    <span className="automation__spec-detail" title={title}>
      <Icon icon={iconDot} className="app-icon--dot" />
      <span className={levelClass("automation__spec-detail", usageLevel(Math.round(percent)))}>
        {Math.round(percent)}%
      </span>
    </span>
  );
}

function SpecDivider() {
  return <span className="automation__spec-divider" aria-hidden="true" />;
}

interface MemoryDetailProps {
  usedBytes: number;
  totalBytes: number;
  title: string;
}

/** Renders a separator dot then "used / total GB", writing the unit only once. */
function MemoryDetail({ usedBytes, totalBytes, title }: MemoryDetailProps) {
  return (
    <span className="automation__spec-detail" title={title}>
      <Icon icon={iconDot} className="app-icon--dot" />
      <span
        className={levelClass(
          "automation__spec-detail",
          usageLevel(memoryPercent(usedBytes, totalBytes)),
        )}
      >
        {formatBytesValue(usedBytes)}
      </span>{" "}
      / {formatBytes(totalBytes)}
    </span>
  );
}
