import { COMFY_WORKFLOW_EXTENSIONS } from "@/shared/constants";
import type { ComfyPassStatus } from "@/shared/types";

const COMFY_WORKFLOW_EXTENSION_SET = new Set<string>(COMFY_WORKFLOW_EXTENSIONS);

/** How a sampling pass that did not run reads; a pass that ran carries no flag. */
export const PASS_NOT_RUN: Record<ComfyPassStatus, { flag: string; status: string } | null> = {
  ran: null,
  switched_off: { flag: "Skipped — switched off", status: "skipped" },
  bypassed: { flag: "Bypassed", status: "bypassed" },
};

/** A file path as its folder, separator included, and its name. */
export function splitPath(path: string): { folder: string; name: string } {
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")) + 1;
  return { folder: path.slice(0, cut), name: path.slice(cut) };
}

/** Splits the backend's `folder/name.safetensors (strength)` display string for styling. */
export function splitLora(lora: string): { folder: string; name: string; strength: string | null } {
  const match = /^(.*?) \(([^()]+)\)$/.exec(lora);
  return { ...splitPath(match ? match[1] : lora), strength: match ? match[2] : null };
}

export function supportsComfyWorkflow(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return false;
  return COMFY_WORKFLOW_EXTENSION_SET.has(path.slice(dot).toLowerCase());
}
