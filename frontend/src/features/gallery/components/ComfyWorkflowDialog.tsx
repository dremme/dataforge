import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useComfyWorkflowPrompts } from "@/features/gallery/hooks/useComfyWorkflowPrompts";
import { useCopyFeedback } from "@/shared/hooks/useCopyFeedback";
import { iconCopy, iconLoader2 } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import type { ComfyOutputBranch } from "@/shared/types";
import { Dialog, DialogButton } from "@/shared/ui/Dialog";
import { Icon } from "@/shared/ui/Icon";

interface ComfyWorkflowDialogProps {
  mediaPath: string;
  mediaName: string;
  onClose: () => void;
}

const LIKELY_OUTPUT_LABEL = "Likely output — matched by filename";
// Model files get full-width rows; their names are too long for a settings tile.
const MODEL_FILE_PATTERN = /\.(safetensors|gguf|ckpt|pth?|bin|sft)$/i;

function describe(
  branches: ComfyOutputBranch[],
  matchedNodeId: string | null | undefined,
  mediaName: string,
): ReactNode {
  if (branches.length === 0) return "This workflow has no output node to trace prompts from.";
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

/** Splits the backend's `folder/name.safetensors (strength)` display string for styling. */
function splitLora(lora: string): { folder: string; name: string; strength: string | null } {
  const match = /^(.*?) \(([^()]+)\)$/.exec(lora);
  const path = match ? match[1] : lora;
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")) + 1;
  return { folder: path.slice(0, cut), name: path.slice(cut), strength: match ? match[2] : null };
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
  onSelect,
}: {
  branches: ComfyOutputBranch[];
  selectedId: string;
  matchedNodeId: string | null | undefined;
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
                      {branch.node_id === matchedNodeId ? LIKELY_OUTPUT_LABEL : "Matches filename"}
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

function BranchDetails({
  branch,
  matchedNodeId,
  onlyOutput,
}: {
  branch: ComfyOutputBranch;
  matchedNodeId: string | null | undefined;
  onlyOutput: boolean;
}) {
  const { copyState, copyLabel, copyText } = useCopyFeedback();
  const allPrompts = branch.prompts.map((prompt) => prompt.text).join("\n\n");
  const models = branch.parameters.filter((parameter) => MODEL_FILE_PATTERN.test(parameter.value));
  const settings = branch.parameters.filter((parameter) => !models.includes(parameter));

  return (
    <div className="dialog__field comfy-workflow-dialog__details-field">
      <div className="dialog__label comfy-workflow-dialog__details-label">
        Prompts
        <button
          type="button"
          className={classNames(
            "comfy-workflow-dialog__copy",
            copyState === "copied" && "comfy-workflow-dialog__copy--copied",
            copyState === "error" && "comfy-workflow-dialog__copy--error",
          )}
          onClick={() => {
            void copyText(allPrompts);
          }}
          disabled={allPrompts.length === 0}
        >
          <Icon icon={iconCopy} className="comfy-workflow-dialog__copy-icon" />
          {copyLabel}
        </button>
      </div>

      <div className="comfy-workflow-dialog__details" role="group" aria-label="Prompts">
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
              ? LIKELY_OUTPUT_LABEL
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

        {models.length > 0 && (
          <div className="comfy-workflow-dialog__group">
            <span className="comfy-workflow-dialog__group-label">Models</span>
            <dl className="comfy-workflow-dialog__models">
              {models.map((parameter) => (
                <div key={`${parameter.label}-${parameter.value}`}>
                  <dt>{parameter.label}</dt>
                  <dd>{parameter.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {branch.loras.length > 0 && (
          <div className="comfy-workflow-dialog__group">
            <span className="comfy-workflow-dialog__group-label">LoRAs</span>
            <ul className="comfy-workflow-dialog__loras">
              {branch.loras.map((lora) => {
                const { folder, name, strength } = splitLora(lora);
                return (
                  <li key={lora} className="comfy-workflow-dialog__lora">
                    <span className="comfy-workflow-dialog__lora-path">
                      {folder && (
                        <span className="comfy-workflow-dialog__lora-folder">{folder}</span>
                      )}
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
        : describe(branches, data?.matched_node_id, mediaName);

  return (
    <Dialog
      title="ComfyUI prompts"
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
              onSelect={setSelectedId}
            />
          )}
          <BranchDetails
            key={selected.node_id}
            branch={selected}
            matchedNodeId={data?.matched_node_id}
            onlyOutput={branches.length === 1}
          />
        </div>
      )}
    </Dialog>
  );
}
