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

const SNIPPET_LENGTH = 70;

function branchSnippet(branch: ComfyOutputBranch): string {
  const positive = branch.prompts.find((prompt) => prompt.role === "positive");
  const text = positive?.text.replace(/\s+/g, " ").trim();
  if (!text) return "No prompt on this path";
  return text.length > SNIPPET_LENGTH ? `${text.slice(0, SNIPPET_LENGTH)}…` : text;
}

function describe(
  branches: ComfyOutputBranch[],
  matchedNodeId: string | null | undefined,
  mediaName: string,
): ReactNode {
  if (branches.length === 0) return "This workflow has no output node to trace prompts from.";
  if (matchedNodeId) {
    return (
      <>
        <strong>{mediaName}</strong> was written by one output; its prompts are below.
      </>
    );
  }

  const claiming = branches.filter((branch) => branch.matches_filename).length;
  if (claiming > 1) {
    return (
      <>
        {claiming} outputs write under the same filename, so ComfyUI's metadata cannot say which one
        made <strong>{mediaName}</strong>. Compare them below.
      </>
    );
  }

  return (
    <>
      No output records a filename matching <strong>{mediaName}</strong>. Every path through the
      workflow is listed below.
    </>
  );
}

function BranchList({
  branches,
  selectedId,
  onSelect,
}: {
  branches: ComfyOutputBranch[];
  selectedId: string;
  onSelect: (nodeId: string) => void;
}) {
  // With every row claiming the filename the chip stops telling them apart; the header says it once.
  const matching = branches.filter((branch) => branch.matches_filename).length;
  const flagMatches = matching > 0 && matching < branches.length;

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
              <span className="comfy-workflow-dialog__output-head">
                <span className="comfy-workflow-dialog__output-label">{branch.label}</span>
                {flagMatches && branch.matches_filename && (
                  <span className="comfy-workflow-dialog__output-flag">matches name</span>
                )}
                {branch.is_preview && (
                  <span className="comfy-workflow-dialog__output-flag comfy-workflow-dialog__output-flag--muted">
                    preview
                  </span>
                )}
              </span>
              <span className="comfy-workflow-dialog__output-snippet">{branchSnippet(branch)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BranchDetails({ branch }: { branch: ComfyOutputBranch }) {
  const { copyState, copyLabel, copyText } = useCopyFeedback();
  const allPrompts = branch.prompts.map((prompt) => prompt.text).join("\n\n");

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

        {branch.loras.length > 0 && (
          <div className="comfy-workflow-dialog__group">
            <span className="comfy-workflow-dialog__group-label">LoRAs</span>
            <ul className="comfy-workflow-dialog__loras">
              {branch.loras.map((lora) => (
                <li key={lora}>{lora}</li>
              ))}
            </ul>
          </div>
        )}

        {branch.parameters.length > 0 && (
          <div className="comfy-workflow-dialog__group">
            <span className="comfy-workflow-dialog__group-label">Settings</span>
            <dl className="comfy-workflow-dialog__parameters">
              {branch.parameters.map((parameter) => (
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

  useEffect(() => {
    setSelectedId(data?.matched_node_id ?? branches[0]?.node_id ?? null);
  }, [branches, data]);

  const selected = branches.find((branch) => branch.node_id === selectedId) ?? branches[0];

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

      {selected && (
        <div className="comfy-workflow-dialog__body">
          {branches.length > 1 && (
            <BranchList
              branches={branches}
              selectedId={selected.node_id}
              onSelect={setSelectedId}
            />
          )}
          <BranchDetails branch={selected} />
        </div>
      )}
    </Dialog>
  );
}
