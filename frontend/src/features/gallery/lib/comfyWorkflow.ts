import { COMFY_WORKFLOW_EXTENSIONS } from "@/shared/constants";

const COMFY_WORKFLOW_EXTENSION_SET = new Set<string>(COMFY_WORKFLOW_EXTENSIONS);

export function supportsComfyWorkflow(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return false;
  return COMFY_WORKFLOW_EXTENSION_SET.has(path.slice(dot).toLowerCase());
}
