import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import type { FolderResponse } from "../src/shared/types";

/** Built fresh by scripts/e2e_backend.py; the same path playwright.config.ts hands the servers. */
export const WORKSPACE = path.join(os.tmpdir(), "dataforge-e2e");

/** Opens the workspace trimmed to one image and one video, with no subfolders. */
export async function openWorkspace(page: Page) {
  await page.route("**/api/folders/contents?**", async (route) => {
    const response = await route.fetch();
    const folder = (await response.json()) as FolderResponse;
    const items = folder.items.filter(
      (item) => item.name === "photo.png" || item.name === "clip.mp4",
    );
    await route.fulfill({
      json: { ...folder, items, item_count: items.length, subfolders: [], subfolder_count: 0 },
    });
  });
  await page.goto(`/?path=${encodeURIComponent(WORKSPACE)}`);
}

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

/** A clean finish leaves no activity strip, so the outcome is read from the jobs drawer. */
export async function expectJobCompleted(page: Page, jobLabel: string, timeout: number) {
  await page.getByRole("button", { name: /^Open automation jobs/ }).click();
  const drawer = page.getByRole("dialog", { name: "Automation jobs" });
  const card = drawer.getByRole("article", { name: new RegExp(`^${jobLabel} job for `) }).first();
  await expect(card).toContainText("Completed", { timeout });
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
}
