import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fetchComfyEditorWorkflow } from "@/features/gallery/api/captions";
import { ComfyWorkflowMap } from "@/features/gallery/components/ComfyWorkflowMap";
import { PASS_NOT_RUN, splitLora } from "@/features/gallery/lib/comfyWorkflow";
import { useComfyWorkflowPrompts } from "@/features/gallery/hooks/useComfyWorkflowPrompts";
import { useCopyFeedback } from "@/shared/hooks/useCopyFeedback";
import { iconCopy, iconLoader2 } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import type { ComfyOutputBranch, ComfyParameter } from "@/shared/types";
import { Dialog, DialogButton } from "@/shared/ui/Dialog";
import { Icon } from "@/shared/ui/Icon";

interface ComfyWorkflowDialogProps {
  mediaPath: string;
  mediaName: string;
  onClose: () => void;
}

const LIKELY_OUTPUT_LABEL = "Likely output — matched by filename";
const LIKELY_BY_SIZE_LABEL = "Likely output — matched by filename and size";
// Model files get full-width rows; their names are too long for a settings tile.
const MODEL_FILE_PATTERN = /\.(safetensors|gguf|ckpt|pth?|bin|sft)$/i;

function describe(
  branches: ComfyOutputBranch[],
  matchedNodeId: string | null | undefined,
  matchedBySize: boolean,
  mediaName: string,
): ReactNode {
  if (branches.length === 0) return "This workflow has no output node to trace prompts from.";
  if (matchedNodeId && matchedBySize) {
    const claiming = branches.filter((branch) => branch.matches_filename).length;
    return (
      <>
        {claiming} outputs share a naming pattern matching <strong>{mediaName}</strong>, and only
        one is set to render at its size. This identifies a likely output, but the embedded workflow
        does not confirm which node wrote the file.
      </>
    );
  }
  if (matchedNodeId) {
    return (
      <>
        One output matches the filename of <strong>{mediaName}</strong>. This identifies a likely
        output, but the embedded workflow does not confirm which node wrote the file.
      </>
    );
  }

  const claiming = branches.filter((branch) => branch.matches_filename).length;
  if (claiming > 1) {
    return (
      <>
        {claiming} outputs share a naming pattern matching <strong>{mediaName}</strong>. The
        embedded workflow cannot identify which one wrote this file.
      </>
    );
  }

  return (
    <>
      The saved names do not identify which output wrote <strong>{mediaName}</strong>. The file may
      have been renamed or the workflow may use a dynamic name.
    </>
  );
}

function OutputIdentity({ branch }: { branch: ComfyOutputBranch }) {
  return (
    <span className="comfy-workflow-dialog__identity">
      <span>
        Node #{branch.node_id} · {branch.class_type}
      </span>
      {branch.filename && <span>Filename: {branch.filename}</span>}
      {branch.filename_prefix && <span>Filename prefix: {branch.filename_prefix}</span>}
      {!branch.filename && !branch.filename_prefix && <span>Saved name not recorded</span>}
    </span>
  );
}

function BranchList({
  branches,
  selectedId,
  matchedNodeId,
  likelyLabel,
  onSelect,
}: {
  branches: ComfyOutputBranch[];
  selectedId: string;
  matchedNodeId: string | null | undefined;
  likelyLabel: string;
  onSelect: (nodeId: string) => void;
}) {
  return (
    <div className="dialog__field comfy-workflow-dialog__outputs-field">
      <div className="dialog__label">Outputs ({branches.length})</div>
      <ul className="comfy-workflow-dialog__outputs" aria-label="Workflow outputs">
        {branches.map((branch) => (
          <li key={branch.node_id}>
            <button
              type="button"
              className={classNames(
                "comfy-workflow-dialog__output",
                branch.node_id === selectedId && "comfy-workflow-dialog__output--selected",
              )}
              onClick={() => onSelect(branch.node_id)}
              aria-current={branch.node_id === selectedId}
            >
              <span className="comfy-workflow-dialog__output-label">{branch.label}</span>
              {(branch.matches_filename || branch.is_preview) && (
                <span className="comfy-workflow-dialog__output-flags">
                  {branch.matches_filename && (
                    <span className="comfy-workflow-dialog__output-flag">
                      {branch.node_id === matchedNodeId ? likelyLabel : "Matches filename"}
                    </span>
                  )}
                  {branch.is_preview && (
                    <span className="comfy-workflow-dialog__output-flag comfy-workflow-dialog__output-flag--muted">
                      preview
                    </span>
                  )}
                </span>
              )}
              <OutputIdentity branch={branch} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Copies the part of the workflow that leads to one output, for pasting into ComfyUI. */
function CopyWorkflowButton({ mediaPath, nodeId }: { mediaPath: string; nodeId: string }) {
  const { copyState, copyText } = useCopyFeedback();
  const [busy, setBusy] = useState(false);
  const label =
    copyState === "copied" ? "Copied!" : copyState === "error" ? "Failed!" : "Copy workflow";

  return (
    <button
      type="button"
      className={classNames(
        "comfy-workflow-dialog__copy",
        copyState === "copied" && "comfy-workflow-dialog__copy--copied",
        copyState === "error" && "comfy-workflow-dialog__copy--error",
      )}
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={() => {
        setBusy(true);
        // Fetched on demand: a workflow can run to megabytes, and most opens never copy it.
        void copyText(fetchComfyEditorWorkflow(mediaPath, nodeId)).finally(() => setBusy(false));
      }}
    >
      <Icon
        icon={busy ? iconLoader2 : iconCopy}
        spin={busy}
        className="comfy-workflow-dialog__copy-icon"
      />
      {label}
    </button>
  );
}

function SettingsGroups({ parameters, loras }: { parameters: ComfyParameter[]; loras: string[] }) {
  const models = parameters.filter((parameter) => MODEL_FILE_PATTERN.test(parameter.value));
  const settings = parameters.filter((parameter) => !models.includes(parameter));

  return (
    <>
      {models.length > 0 && (
        <div className="comfy-workflow-dialog__group">
          <span className="comfy-workflow-dialog__group-label">Models</span>
          <dl className="comfy-workflow-dialog__models">
            {models.map((parameter) => (
              <div key={`${parameter.label}-${parameter.value}`}>
                <dt>{parameter.label}</dt>
                <dd title={parameter.value}>{parameter.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {loras.length > 0 && (
        <div className="comfy-workflow-dialog__group">
          <span className="comfy-workflow-dialog__group-label">LoRAs</span>
          <ul className="comfy-workflow-dialog__loras">
            {loras.map((lora) => {
              const { folder, name, strength } = splitLora(lora);
              return (
                <li key={lora} className="comfy-workflow-dialog__lora">
                  <span className="comfy-workflow-dialog__lora-path" title={folder + name}>
                    {folder && <span className="comfy-workflow-dialog__lora-folder">{folder}</span>}
                    {name}
                  </span>
                  {strength && (
                    <span className="comfy-workflow-dialog__lora-strength">{strength}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {settings.length > 0 && (
        <div className="comfy-workflow-dialog__group">
          <span className="comfy-workflow-dialog__group-label">Settings</span>
          <dl className="comfy-workflow-dialog__parameters">
            {settings.map((parameter) => (
              <div key={`${parameter.label}-${parameter.value}`}>
                <dt>{parameter.label}</dt>
                <dd>{parameter.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </>
  );
}

/** One section per sampling pass, so settings that run together read together. */
function SamplingPasses({
  branch,
  sections,
}: {
  branch: ComfyOutputBranch;
  /** Filled with each pass's section, so the workflow map can open one. */
  sections: Map<string, HTMLElement>;
}) {
  const hasShared = branch.parameters.length > 0 || branch.loras.length > 0;

  return (
    <>
      {hasShared && (
        <section className="comfy-workflow-dialog__pass" aria-label="Shared settings">
          <div className="comfy-workflow-dialog__pass-head">
            <span className="comfy-workflow-dialog__pass-label">Shared</span>
            <span className="comfy-workflow-dialog__pass-group">
              Read by several passes or the output
            </span>
          </div>
          <SettingsGroups parameters={branch.parameters} loras={branch.loras} />
        </section>
      )}

      {branch.stages.map((stage, index) => {
        const notRun = PASS_NOT_RUN[stage.status];
        const hasSettings = stage.parameters.length > 0 || stage.loras.length > 0;
        return (
          <section
            key={stage.node_id}
            ref={(element) => {
              if (element) sections.set(stage.node_id, element);
              else sections.delete(stage.node_id);
            }}
            className={classNames(
              "comfy-workflow-dialog__pass",
              notRun && "comfy-workflow-dialog__pass--skipped",
            )}
            aria-label={`Pass ${index + 1}: ${stage.label}${notRun ? `, ${notRun.status}` : ""}`}
          >
            <div className="comfy-workflow-dialog__pass-head">
              <span className="comfy-workflow-dialog__pass-number">Pass {index + 1}</span>
              <span className="comfy-workflow-dialog__pass-label">{stage.label}</span>
              {notRun && <span className="comfy-workflow-dialog__pass-flag">{notRun.flag}</span>}
              {stage.group && (
                <span className="comfy-workflow-dialog__pass-group">{stage.group}</span>
              )}
            </div>
            {hasSettings ? (
              <div className="comfy-workflow-dialog__pass-body">
                <SettingsGroups parameters={stage.parameters} loras={stage.loras} />
              </div>
            ) : (
              <p className="comfy-workflow-dialog__empty">
                {stage.status === "bypassed"
                  ? "The workflow does not record this bypassed node's settings."
                  : "No settings of its own."}
              </p>
            )}
          </section>
        );
      })}
    </>
  );
}

function BranchDetails({
  branch,
  matchedNodeId,
  likelyLabel,
  onlyOutput,
  mediaPath,
  canCopyWorkflow,
}: {
  branch: ComfyOutputBranch;
  matchedNodeId: string | null | undefined;
  likelyLabel: string;
  onlyOutput: boolean;
  mediaPath: string;
  canCopyWorkflow: boolean;
}) {
  const sections = useRef(new Map<string, HTMLElement>());
  // Numbered as their sections are; a single pass has no section and is simply pass 1.
  const passNumbers = useMemo(() => {
    const passes =
      branch.stages.length > 0
        ? branch.stages.map((stage) => stage.node_id)
        : branch.map.filter((node) => node.kind === "pass").map((node) => node.id);
    return new Map(passes.map((nodeId, index) => [nodeId, index + 1]));
  }, [branch]);
  // A single pass owns every setting on the branch; otherwise each pass has its own.
  const passSettings = useMemo(
    () =>
      branch.stages.length > 0
        ? new Map(branch.stages.map((stage) => [stage.node_id, stage.parameters]))
        : new Map([...passNumbers.keys()].map((nodeId) => [nodeId, branch.parameters])),
    [branch, passNumbers],
  );

  return (
    <div className="dialog__field comfy-workflow-dialog__details-field">
      <div className="dialog__label">
        Details
        {canCopyWorkflow && <CopyWorkflowButton mediaPath={mediaPath} nodeId={branch.node_id} />}
      </div>

      <div className="comfy-workflow-dialog__details" role="group" aria-label="Details">
        <div
          className="comfy-workflow-dialog__selected-output"
          role="group"
          aria-label="Selected output"
        >
          <strong className="comfy-workflow-dialog__selected-label">{branch.label}</strong>
          <OutputIdentity branch={branch} />
          <p
            className={classNames(
              "comfy-workflow-dialog__source-status",
              branch.node_id === matchedNodeId && "comfy-workflow-dialog__source-status--matched",
            )}
          >
            {branch.node_id === matchedNodeId
              ? likelyLabel
              : onlyOutput
                ? "Only output in embedded workflow — filename unverified"
                : "Selected for inspection — source unverified"}
          </p>
        </div>
        {branch.prompts.length === 0 && (
          <p className="comfy-workflow-dialog__empty">
            Nothing on this path carries text - it renders from an image, not a prompt.
          </p>
        )}

        {branch.prompts.map((prompt) => (
          <div
            key={`${prompt.node_id}-${prompt.input_name}`}
            className={classNames(
              "comfy-workflow-dialog__prompt",
              `comfy-workflow-dialog__prompt--${prompt.role}`,
            )}
          >
            <div className="comfy-workflow-dialog__prompt-head">
              <span className="comfy-workflow-dialog__prompt-role">{prompt.role}</span>
              <span className="comfy-workflow-dialog__prompt-source">
                {prompt.node_title ?? prompt.node_id}
              </span>
            </div>
            <p className="comfy-workflow-dialog__prompt-text">{prompt.text}</p>
          </div>
        ))}

        {branch.stages.length > 0 ? (
          <SamplingPasses branch={branch} sections={sections.current} />
        ) : (
          <SettingsGroups parameters={branch.parameters} loras={branch.loras} />
        )}

        {branch.map.length > 0 && (
          <ComfyWorkflowMap
            map={branch.map}
            passNumbers={passNumbers}
            passSettings={passSettings}
            output={branch.label}
            onSelect={
              branch.stages.length > 0
                ? (nodeId) =>
                    sections.current
                      .get(nodeId)
                      ?.scrollIntoView({ block: "nearest", behavior: "smooth" })
                : undefined
            }
          />
        )}
      </div>
    </div>
  );
}

export function ComfyWorkflowDialog({ mediaPath, mediaName, onClose }: ComfyWorkflowDialogProps) {
  const { loading, error, data } = useComfyWorkflowPrompts(mediaPath, true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const branches = useMemo(() => data?.branches ?? [], [data]);

  // A pick belongs to one file's workflow; another file starts from its own default.
  useEffect(() => {
    setSelectedId(null);
  }, [data, mediaPath]);

  // Something is always shown: the pick, else the filename match, else the first output.
  const selected =
    branches.find((branch) => branch.node_id === selectedId) ??
    branches.find((branch) => branch.node_id === data?.matched_node_id) ??
    branches[0];

  const description = loading
    ? "Reading the workflow embedded in this file..."
    : error
      ? null
      : data?.has_workflow === false
        ? "This file carries no ComfyUI workflow."
        : describe(branches, data?.matched_node_id, data?.matched_by_size === true, mediaName);
  const likelyLabel = data?.matched_by_size ? LIKELY_BY_SIZE_LABEL : LIKELY_OUTPUT_LABEL;

  return (
    <Dialog
      title="ComfyUI workflow"
      role="dialog"
      panelClassName="comfy-workflow-dialog"
      description={description}
      onClose={onClose}
      footer={<DialogButton label="Close" variant="secondary" onClick={onClose} />}
    >
      {loading && (
        <p className="comfy-workflow-dialog__status">
          <Icon icon={iconLoader2} spin className="comfy-workflow-dialog__status-icon" />
          Loading
        </p>
      )}

      {error && <p className="comfy-workflow-dialog__status">{error}</p>}

      {!loading && !error && selected && (
        <div className="comfy-workflow-dialog__body">
          {branches.length > 1 && (
            <BranchList
              branches={branches}
              selectedId={selected.node_id}
              matchedNodeId={data?.matched_node_id}
              likelyLabel={likelyLabel}
              onSelect={setSelectedId}
            />
          )}
          <BranchDetails
            key={`${mediaPath}|${selected.node_id}`}
            branch={selected}
            matchedNodeId={data?.matched_node_id}
            likelyLabel={likelyLabel}
            onlyOutput={branches.length === 1}
            mediaPath={mediaPath}
            canCopyWorkflow={data?.has_editor_workflow === true}
          />
        </div>
      )}
    </Dialog>
  );
}
