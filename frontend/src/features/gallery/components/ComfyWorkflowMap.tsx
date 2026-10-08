import { useId, useState, type CSSProperties } from "react";
import { PASS_NOT_RUN, splitLora, splitPath } from "@/features/gallery/lib/comfyWorkflow";
import { layoutWorkflowMap, splitLabel } from "@/features/gallery/lib/workflowMapLayout";
import {
  iconBrain,
  iconImage,
  iconLayers,
  iconQuote,
  iconVae,
  iconVideo,
  iconVolume2,
  type AppIcon,
} from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import type {
  ComfyMapNode,
  ComfyMapNodeKind,
  ComfyMediaKind,
  ComfyParameter,
} from "@/shared/types";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";

const KIND_NAMES: Record<ComfyMapNodeKind, string> = {
  pass: "Pass",
  model: "Model",
  loras: "LoRAs",
  vae: "VAE",
  prompt: "Prompt",
  input: "Input",
  output: "Output",
};

/** A pass shows its number instead, which matches its section; media boxes show their media. */
const ICONS: Record<Exclude<ComfyMapNodeKind, "pass">, AppIcon> = {
  model: iconBrain,
  loras: iconLayers,
  vae: iconVae,
  input: iconImage,
  prompt: iconQuote,
  output: iconImage,
};

const MEDIA_ICONS: Record<ComfyMediaKind, AppIcon> = {
  image: iconImage,
  video: iconVideo,
  audio: iconVolume2,
};

const TONES = ["accent", "model", "loras", "vae", "input", "prompt", "negative"] as const;

/** The settings a pass's tooltip leads with, in this order; the rest are in its section. */
const PASS_TIP_SETTINGS = ["Steps", "CFG", "Denoise", "Sampler", "Scheduler", "Seed"];

/** What the pointer or focus rests on: a box, or one edge by its two ends. */
type Trace = { node: string } | { from: string; to: string } | null;

/** The hue a box and the edges leaving it are drawn in. */
function tone(node: ComfyMapNode): string {
  if (node.kind === "prompt") return node.role === "negative" ? "negative" : "prompt";
  return node.kind === "pass" || node.kind === "output" ? "accent" : node.kind;
}

function glyph(node: ComfyMapNode): AppIcon | null {
  if (node.kind === "pass") return null;
  return node.media ? MEDIA_ICONS[node.media] : ICONS[node.kind];
}

/** Whether a label is a file name, whose end tells it apart, so it is cut in the middle. */
function isFileName(node: ComfyMapNode): boolean {
  return node.kind === "model" || node.kind === "vae" || (node.kind === "input" && !node.source);
}

function kindName(node: ComfyMapNode, passNumber: number | undefined): string {
  if (node.kind === "pass") return passNumber === undefined ? "Pass" : `Pass ${passNumber}`;
  if (node.kind === "prompt") {
    return node.role === "negative" ? "Negative prompt" : "Positive prompt";
  }
  if (node.kind === "input" && node.media) {
    const { media } = node;
    return node.source ? `Generated ${media}` : `${media[0].toUpperCase()}${media.slice(1)} input`;
  }
  return KIND_NAMES[node.kind];
}

/** A file's path, its folder muted; ``truncated`` keeps it to one line, cut with an ellipsis. */
function FilePath({ path, truncated = false }: { path: string; truncated?: boolean }) {
  const { folder, name } = splitPath(path);
  return (
    <span
      className={classNames(
        "workflow-map-tip__path",
        truncated && "workflow-map-tip__path--truncated",
      )}
      title={truncated ? path : undefined}
    >
      {folder && <span className="workflow-map-tip__folder">{folder}</span>}
      {name}
    </span>
  );
}

/** The bubble for one box: what it is, whether it ran, and the detail its label had to cut. */
function MapTip({
  node,
  passNumber,
  settings,
  opens,
  output,
}: {
  node: ComfyMapNode;
  passNumber: number | undefined;
  settings: ComfyParameter[];
  opens: boolean;
  output: string;
}) {
  const Glyph = glyph(node);
  const notRun = PASS_NOT_RUN[node.status];
  const generated = node.kind === "input" && Boolean(node.source);
  const leading = PASS_TIP_SETTINGS.flatMap((label) =>
    settings.filter((parameter) => parameter.label === label),
  );

  return (
    <span className={`workflow-map-tip workflow-map-tip--${tone(node)}`}>
      <span className="workflow-map-tip__head">
        <span className="workflow-map-tip__chip">
          {Glyph ? <Icon icon={Glyph} className="workflow-map-tip__icon" /> : passNumber}
        </span>
        <span className="workflow-map-tip__kind">{kindName(node, passNumber)}</span>
        {notRun && <span className="workflow-map-tip__status">{notRun.flag}</span>}
      </span>

      {node.kind === "pass" && <span className="workflow-map-tip__title">{node.label}</span>}
      {node.kind === "output" && <span className="workflow-map-tip__title">{output}</span>}
      {generated && (
        <>
          <span className="workflow-map-tip__title">{node.source}</span>
          {node.detail[0] && <span className="workflow-map-tip__prompt">{node.detail[0]}</span>}
        </>
      )}
      {isFileName(node) && node.detail.map((path) => <FilePath key={path} path={path} />)}
      {node.kind === "prompt" && (
        <span className="workflow-map-tip__prompt">{node.detail[0] ?? node.label}</span>
      )}
      {node.kind === "loras" && (
        <span className="workflow-map-tip__list">
          {node.detail.map((lora) => {
            const { folder, name, strength } = splitLora(lora);
            return (
              <span key={lora} className="workflow-map-tip__row">
                <FilePath path={folder + name} truncated />
                {strength && <span className="workflow-map-tip__value">{strength}</span>}
              </span>
            );
          })}
        </span>
      )}
      {leading.length > 0 && (
        <span className="workflow-map-tip__settings">
          {leading.map((parameter) => (
            <span key={`${parameter.label}-${parameter.value}`} className="workflow-map-tip__row">
              <span className="workflow-map-tip__label">{parameter.label}</span>
              <span className="workflow-map-tip__value">{parameter.value}</span>
            </span>
          ))}
        </span>
      )}
      {opens && <span className="workflow-map-tip__hint">Click to show its settings</span>}
    </span>
  );
}

function MapLabel({ node }: { node: ComfyMapNode }) {
  const { head, tail } = splitLabel(node.label, isFileName(node));
  return (
    <span className="comfy-workflow-dialog__map-label">
      <span className="comfy-workflow-dialog__map-label-head">{head}</span>
      {tail && <span className="comfy-workflow-dialog__map-label-tail">{tail}</span>}
    </span>
  );
}

/**
 * A small diagram of the output's passes and what feeds them: models, LoRAs, VAEs, input media
 * and prompts. Lines are drawn in an SVG; the boxes are HTML over it, so they can carry tooltips.
 * A pass with its own section opens it.
 */
export function ComfyWorkflowMap({
  map,
  passNumbers,
  passSettings,
  output,
  onSelect,
}: {
  map: ComfyMapNode[];
  /** 1-based numbers of the passes, matching their sections. */
  passNumbers: ReadonlyMap<string, number>;
  /** Each pass's own settings, for its tooltip. */
  passSettings: ReadonlyMap<string, ComfyParameter[]>;
  /** What the output box's tooltip names it. */
  output: string;
  onSelect?: (nodeId: string) => void;
}) {
  const baseId = useId().replace(/[^\w-]/g, "");
  const gridId = `workflow-map-grid-${baseId}`;
  const arrowId = (edgeTone: string) => `workflow-map-arrow-${baseId}-${edgeTone}`;
  const layout = layoutWorkflowMap(map);
  const tones = new Map(map.map((node) => [node.id, tone(node)]));
  const [trace, setTrace] = useState<Trace>(null);

  // Tracing lights a box's edges and the boxes at their other ends, and dims everything else.
  const litEdge = (edge: { from: string; to: string }) =>
    trace !== null &&
    ("node" in trace
      ? edge.from === trace.node || edge.to === trace.node
      : edge.from === trace.from && edge.to === trace.to);
  const litNodes = new Set(layout.edges.filter(litEdge).flatMap((edge) => [edge.from, edge.to]));
  if (trace !== null && "node" in trace) litNodes.add(trace.node);
  const percent = (value: number, of: number) => `${(value / of) * 100}%`;

  return (
    <div className="comfy-workflow-dialog__group">
      <span className="comfy-workflow-dialog__group-label">Workflow map</span>
      <div
        className={classNames(
          "comfy-workflow-dialog__map",
          trace !== null && "comfy-workflow-dialog__map--tracing",
        )}
        style={{ aspectRatio: `${layout.width} / ${layout.height}` }}
        role="group"
        aria-label="Workflow map"
      >
        <svg
          className="comfy-workflow-dialog__map-wires"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          aria-hidden="true"
        >
          <defs>
            {/* The dotted canvas of a node editor. */}
            <pattern id={gridId} width="12" height="12" patternUnits="userSpaceOnUse">
              <circle className="comfy-workflow-dialog__map-dot" cx="6" cy="6" r="0.7" />
            </pattern>
            {/* One arrowhead per hue: a marker cannot take its colour from the edge it ends. */}
            {TONES.map((edgeTone) => (
              <marker
                key={edgeTone}
                id={arrowId(edgeTone)}
                className={`comfy-workflow-dialog__map-tone--${edgeTone}`}
                viewBox="0 0 6 6"
                refX="5.5"
                refY="3"
                markerWidth="5"
                markerHeight="5"
                markerUnits="userSpaceOnUse"
                orient="auto"
              >
                <path
                  className="comfy-workflow-dialog__map-arrow"
                  d="M 0.5 0.5 L 5.5 3 L 0.5 5.5 z"
                />
              </marker>
            ))}
          </defs>
          <rect
            className="comfy-workflow-dialog__map-canvas"
            width={layout.width}
            height={layout.height}
            rx="10"
          />
          <rect width={layout.width} height={layout.height} rx="10" fill={`url(#${gridId})`} />

          {layout.edges.map((edge) => (
            <g
              key={`${edge.from}>${edge.to}`}
              className={classNames(
                "comfy-workflow-dialog__map-edge",
                `comfy-workflow-dialog__map-tone--${tones.get(edge.from)}`,
                !edge.ran && "comfy-workflow-dialog__map-edge--skipped",
                litEdge(edge) && "comfy-workflow-dialog__map-edge--lit",
              )}
              onMouseEnter={() => setTrace({ from: edge.from, to: edge.to })}
              onMouseLeave={() => setTrace(null)}
            >
              <path
                className="comfy-workflow-dialog__map-line"
                d={edge.path}
                markerEnd={`url(#${arrowId(tones.get(edge.from)!)})`}
              />
              {/* A wide, invisible stroke so a thin line is easy to point at. */}
              <path className="comfy-workflow-dialog__map-hit" d={edge.path} />
            </g>
          ))}
        </svg>

        {layout.nodes.map(({ node, ran, x, y, width, height }) => {
          const number = passNumbers.get(node.id);
          const notRun = PASS_NOT_RUN[node.status];
          const opens = node.kind === "pass" && onSelect !== undefined && number !== undefined;
          const Glyph = glyph(node);
          const slot: CSSProperties = {
            left: percent(x, layout.width),
            top: percent(y, layout.height),
            width: percent(width, layout.width),
            height: percent(height, layout.height),
          };
          const className = classNames(
            "comfy-workflow-dialog__map-node",
            `comfy-workflow-dialog__map-node--${node.kind}`,
            `comfy-workflow-dialog__map-tone--${tones.get(node.id)}`,
            !ran && "comfy-workflow-dialog__map-node--skipped",
            litNodes.has(node.id) && "comfy-workflow-dialog__map-node--lit",
          );
          const body = (
            <>
              <span className="comfy-workflow-dialog__map-chip" aria-hidden="true">
                {Glyph ? <Icon icon={Glyph} className="comfy-workflow-dialog__map-icon" /> : number}
              </span>
              <MapLabel node={node} />
            </>
          );
          const traceHandlers = {
            onMouseEnter: () => setTrace({ node: node.id }),
            onMouseLeave: () => setTrace(null),
            onFocus: () => setTrace({ node: node.id }),
            onBlur: () => setTrace(null),
          };
          return (
            <Tooltip
              key={node.id}
              className="comfy-workflow-dialog__map-slot"
              bubbleClassName="workflow-map-tip-bubble"
              style={slot}
              content={
                <MapTip
                  node={node}
                  passNumber={number}
                  settings={passSettings.get(node.id) ?? []}
                  opens={opens}
                  output={output}
                />
              }
            >
              {opens ? (
                <button
                  type="button"
                  className={className}
                  aria-label={`Pass ${number}: ${node.label}${notRun ? `, ${notRun.status}` : ""}`}
                  onClick={() => onSelect(node.id)}
                  {...traceHandlers}
                >
                  {body}
                </button>
              ) : (
                <span className={className} {...traceHandlers}>
                  {body}
                </span>
              )}
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
