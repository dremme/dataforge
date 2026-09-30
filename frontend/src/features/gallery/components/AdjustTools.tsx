import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  adjustRange,
  formatAdjustValue,
  isAdjustIdentity,
  type AdjustTool,
} from "@/features/gallery/lib/colorAdjust";
import { AUTO_ADJUST_DEFAULT_AMOUNT } from "@/shared/constants";
import {
  iconAdjustExposure,
  iconAdjustBrilliance,
  iconAdjustHighlights,
  iconAdjustShadows,
  iconAdjustContrast,
  iconAdjustBrightness,
  iconAdjustBlackPoint,
  iconAdjustSaturation,
  iconAdjustVibrance,
  iconAdjustWarmth,
  iconAdjustTint,
  iconAdjustHue,
  iconAdjustDefinition,
  iconAdjustNoiseReduction,
  iconLoader2,
  iconRotateCcw,
  iconSquareSplitHorizontal,
  iconWandSparkles,
  type AppIcon,
} from "@/shared/icons";
import { useTabList } from "@/shared/hooks/useTabList";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";
import { RulerDial } from "@/shared/ui/RulerDial";
import { Tooltip } from "@/shared/ui/Tooltip";
import type { ColorAdjustControls } from "@/features/gallery/hooks/useColorAdjust";

type StripId = "auto" | AdjustTool;

const TOOLS: ReadonlyArray<{ id: AdjustTool; label: string; icon: AppIcon }> = [
  { id: "exposure", label: "Exposure", icon: iconAdjustExposure },
  { id: "brilliance", label: "Brilliance", icon: iconAdjustBrilliance },
  { id: "highlights", label: "Highlights", icon: iconAdjustHighlights },
  { id: "shadows", label: "Shadows", icon: iconAdjustShadows },
  { id: "contrast", label: "Contrast", icon: iconAdjustContrast },
  { id: "brightness", label: "Brightness", icon: iconAdjustBrightness },
  { id: "black_point", label: "Black Point", icon: iconAdjustBlackPoint },
  { id: "saturation", label: "Saturation", icon: iconAdjustSaturation },
  { id: "vibrance", label: "Vibrance", icon: iconAdjustVibrance },
  { id: "warmth", label: "Warmth", icon: iconAdjustWarmth },
  { id: "tint", label: "Tint", icon: iconAdjustTint },
  { id: "hue", label: "Hue", icon: iconAdjustHue },
  { id: "definition", label: "Definition", icon: iconAdjustDefinition },
  { id: "noise_reduction", label: "Noise Reduction", icon: iconAdjustNoiseReduction },
];

const STRIP_IDS: readonly StripId[] = ["auto", ...TOOLS.map((tool) => tool.id)];

const AUTO_RANGE = { min: 0, max: 1, step: 0.01 };

function formatAmount(amount: number): string {
  return String(Math.round(amount * 100));
}

function ringShare(tool: AdjustTool, value: number): number {
  const { max } = adjustRange(tool);
  return Math.min(1, Math.abs(value) / max);
}

interface AdjustToolsProps {
  controls: ColorAdjustControls;
  disabled: boolean;
}

export function AdjustTools({ controls, disabled }: AdjustToolsProps) {
  const [selected, setSelected] = useState<StripId>("exposure");
  const stripRef = useRef<HTMLDivElement>(null);
  const tabs = useTabList(STRIP_IDS, selected, setSelected);

  const [overflow, setOverflow] = useState({ start: false, end: false });

  const autoOn = controls.auto !== null;

  const measureOverflow = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const start = strip.scrollLeft > 1;
    const end = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
    setOverflow((current) =>
      current.start === start && current.end === end ? current : { start, end },
    );
  }, []);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    // A mouse wheel only scrolls vertically, and the strip scrolls sideways alone.
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (strip.scrollWidth <= strip.clientWidth) return;
      event.preventDefault();
      strip.scrollLeft += event.deltaY;
    };
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(strip);
    strip.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      strip.removeEventListener("wheel", wheel);
    };
  }, [measureOverflow]);

  // scrollIntoView would also scroll the modal; only the strip may move.
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const tab = strip?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!strip || !tab) return;
    const bounds = strip.getBoundingClientRect();
    const tabBounds = tab.getBoundingClientRect();
    const left = tabBounds.left - bounds.left + strip.scrollLeft;
    const right = left + tabBounds.width;
    if (left < strip.scrollLeft) strip.scrollLeft = left;
    else if (right > strip.scrollLeft + strip.clientWidth) {
      strip.scrollLeft = right - strip.clientWidth;
    }
    measureOverflow();
  }, [measureOverflow, selected]);

  const handleWandClick = () => {
    setSelected("auto");
    if (controls.autoPending) return;
    if (!autoOn) controls.activateAuto();
    else if (selected === "auto") controls.deactivateAuto();
  };

  const tool = TOOLS.find((entry) => entry.id === selected);

  return (
    <div className="adjust-tools">
      <div
        ref={stripRef}
        className={classNames(
          "adjust-tools__strip",
          overflow.start && "adjust-tools__strip--more-start",
          overflow.end && "adjust-tools__strip--more-end",
        )}
        aria-label="Adjustments"
        data-scroll-lock-allow
        onScroll={measureOverflow}
        {...tabs.tabListProps}
      >
        <Tooltip
          content={
            autoOn && selected === "auto" ? "Auto (click to turn off)" : "Auto: fix levels and cast"
          }
        >
          <button
            {...tabs.tabProps("auto")}
            className={classNames(
              "adjust-tools__tab",
              "adjust-tools__tab--auto",
              autoOn && "adjust-tools__tab--changed",
            )}
            aria-label={autoOn ? `Auto, ${formatAmount(controls.auto?.amount ?? 0)}` : "Auto"}
            aria-busy={controls.autoPending || undefined}
            disabled={disabled}
            style={ringStyle(autoOn ? (controls.auto?.amount ?? 0) : 0, false)}
            onClick={handleWandClick}
          >
            <ToolRing />
            <Icon
              icon={controls.autoPending ? iconLoader2 : iconWandSparkles}
              spin={controls.autoPending}
            />
          </button>
        </Tooltip>

        {TOOLS.map((entry) => {
          const value = controls.values[entry.id];
          const changed = Math.abs(value) > 1e-9;
          return (
            <Tooltip key={entry.id} content={entry.label}>
              <button
                {...tabs.tabProps(entry.id)}
                className={classNames("adjust-tools__tab", changed && "adjust-tools__tab--changed")}
                aria-label={
                  changed ? `${entry.label}, ${formatAdjustValue(entry.id, value)}` : entry.label
                }
                disabled={disabled}
                style={ringStyle(ringShare(entry.id, value), value < 0)}
              >
                <ToolRing />
                <Icon icon={entry.icon} className="adjust-tools__glyph" />
              </button>
            </Tooltip>
          );
        })}
      </div>

      <div className="adjust-tools__dial" {...tabs.panelProps(selected)}>
        {tool ? (
          <RulerDial
            label={tool.label}
            value={controls.values[tool.id]}
            {...adjustRange(tool.id)}
            format={(value) => formatAdjustValue(tool.id, value)}
            disabled={disabled}
            onChange={(value) => controls.set(tool.id, value)}
          />
        ) : (
          <RulerDial
            label="Auto"
            value={controls.auto?.amount ?? 0}
            {...AUTO_RANGE}
            rest={AUTO_ADJUST_DEFAULT_AMOUNT}
            origin={AUTO_RANGE.min}
            format={(amount) => (autoOn ? formatAmount(amount) : "Off")}
            disabled={disabled || !autoOn}
            onChange={controls.setAutoAmount}
          />
        )}
      </div>

      <div className="adjust-tools__actions">
        <Tooltip content="Hold to see the original">
          <button
            type="button"
            className={classNames(
              "adjust-tools__action",
              controls.comparing && "adjust-tools__action--pressed",
            )}
            aria-label="Hold to see the original"
            aria-pressed={controls.comparing}
            disabled={disabled || isAdjustIdentity(controls.values)}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              controls.setComparing(true);
            }}
            onPointerUp={() => controls.setComparing(false)}
            onPointerCancel={() => controls.setComparing(false)}
            onLostPointerCapture={() => controls.setComparing(false)}
            onKeyDown={(event) => {
              if (event.key !== " " && event.key !== "Enter") return;
              event.preventDefault();
              controls.setComparing(true);
            }}
            onKeyUp={() => controls.setComparing(false)}
            onBlur={() => controls.setComparing(false)}
          >
            <Icon icon={iconSquareSplitHorizontal} />
          </button>
        </Tooltip>
        <Tooltip content="Reset adjustments">
          <button
            type="button"
            className="adjust-tools__action"
            aria-label="Reset adjustments"
            disabled={
              disabled || (isAdjustIdentity(controls.values) && !autoOn && !controls.autoPending)
            }
            onClick={controls.reset}
          >
            <Icon icon={iconRotateCcw} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function ringStyle(share: number, reversed: boolean): CSSProperties {
  return {
    "--ring-share": share,
    "--ring-direction": reversed ? -1 : 1,
  } as CSSProperties;
}

function ToolRing() {
  return (
    <svg className="adjust-tools__ring" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <circle className="adjust-tools__ring-track" cx="14" cy="14" r="12.5" pathLength={100} />
      <circle className="adjust-tools__ring-value" cx="14" cy="14" r="12.5" pathLength={100} />
    </svg>
  );
}
