import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Built fresh by scripts/e2e_backend.py; the same path playwright.config.ts hands the servers. */
export const WORKSPACE = path.join(os.tmpdir(), "dataforge-e2e");

export interface ModelRequest {
  model: string;
  messages: { role: string; content: string | ContentPart[] }[];
}

export interface ContentPart {
  type: string;
  text?: string;
  image_url?: { url: string };
}

export function readSidecar(name: string): string {
  return fs.readFileSync(path.join(WORKSPACE, name), "utf-8");
}

/** Every request the stand-in model answered, in the order the job made them. */
export function readModelRequests(): ModelRequest[] {
  return JSON.parse(fs.readFileSync(path.join(WORKSPACE, "model-requests.json"), "utf-8"));
}

export function imageParts(request: ModelRequest): ContentPart[] {
  const user = request.messages.find((message) => message.role === "user");
  const content = Array.isArray(user?.content) ? user.content : [];
  return content.filter((part) => part.type === "image_url");
}

export function systemText(request: ModelRequest): string {
  const system = request.messages.find((message) => message.role === "system");
  return typeof system?.content === "string" ? system.content : "";
}
