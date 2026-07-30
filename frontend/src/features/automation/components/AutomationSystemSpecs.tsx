import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { iconCpu, iconGpu, iconMemoryStick } from "@/shared/icons";
import { useSystemSpecs } from "@/features/automation/hooks/useSystemSpecs";
import { classNames } from "@/shared/lib/classNames";
import { formatBytes, formatBytesValue } from "@/shared/lib/format";
import { Icon } from "@/shared/ui/Icon";

/** Memory usage at or above this share of the total is shown in the warning color. */
const MEMORY_WARNING_RATIO = 0.75;

function memoryIsHigh(usedBytes: number, totalBytes: number): boolean {
  return totalBytes > 0 && usedBytes / totalBytes >= MEMORY_WARNING_RATIO;
}

export interface AutomationSystemSpecsProps {
  /** Matches the aria-controls of the toggle button in the automation header. */
  id: string;
  open: boolean;
}

/** Collapsible CPU / RAM / GPU readout under the automation header. */
export function AutomationSystemSpecs({ id, open }: AutomationSystemSpecsProps) {
  const specs = useSystemSpecs();
  if (!specs) return null;

  const { gpu_name, gpu_memory_bytes, gpu_memory_used_bytes } = specs;
  const hasGpu = specs.gpu_available && gpu_name !== null;

  return (
    <div
      id={id}
      className={classNames("automation__specs-panel", open && "automation__specs-panel--open")}
    >
      <div className="automation__specs-panel-inner">
        <div className="automation__specs" role="region" aria-label="System specifications">
          <Spec icon={iconCpu}>
            {specs.cpu_name}
            <span className="automation__spec-detail"> · {specs.cpu_cores} cores</span>
          </Spec>

          <SpecDivider />

          <Spec icon={iconMemoryStick}>
            RAM
            <MemoryDetail
              usedBytes={specs.memory_used_bytes}
              totalBytes={specs.memory_total_bytes}
              title="RAM used / total"
            />
          </Spec>

          <SpecDivider />

          <Spec icon={iconGpu}>
            {hasGpu ? (
              <>
                {gpu_name}
                {gpu_memory_bytes !== null &&
                  (gpu_memory_used_bytes !== null ? (
                    <MemoryDetail
                      usedBytes={gpu_memory_used_bytes}
                      totalBytes={gpu_memory_bytes}
                      title="VRAM used / total"
                    />
                  ) : (
                    <span className="automation__spec-detail" title="VRAM total">
                      {" "}
                      · {formatBytes(gpu_memory_bytes)}
                    </span>
                  ))}
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

function Spec({ icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="automation__spec">
      <Icon icon={icon} className="automation__spec-icon" />
      <span className="automation__spec-label">{children}</span>
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

/** Renders " · used / total GB", writing the unit only once. */
function MemoryDetail({ usedBytes, totalBytes, title }: MemoryDetailProps) {
  return (
    <span className="automation__spec-detail" title={title}>
      {" "}
      ·{" "}
      <span
        className={
          memoryIsHigh(usedBytes, totalBytes) ? "automation__spec-detail--warning" : undefined
        }
      >
        {formatBytesValue(usedBytes)}
      </span>{" "}
      / {formatBytes(totalBytes)}
    </span>
  );
}
