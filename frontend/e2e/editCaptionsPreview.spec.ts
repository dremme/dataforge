import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  WORKSPACE,
  expectJobCompleted,
  imageParts,
  readModelRequests,
  systemText,
} from "./workspace";

test("previews caption edits without writes, then starts the normal backed-up job", async ({
  page,
}, testInfo) => {
  const folder = fs.mkdtempSync(path.join(WORKSPACE, "caption-preview-"));
  const original =
    "A red hatchback was parked beside a stone wall with birch trees behind it. " +
    "A bicycle leaned against the wall and the light cast long shadows over the gravel.";
  const names = ["one", "two", "three", "four"];
  for (const name of names) {
    fs.copyFileSync(path.join(WORKSPACE, "photo.png"), path.join(folder, `${name}.png`));
    fs.writeFileSync(path.join(folder, `${name}.txt`), original);
  }
  const requestCount = fs.existsSync(path.join(WORKSPACE, "model-requests.json"))
    ? readModelRequests().length
    : 0;
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.goto(`/?path=${encodeURIComponent(folder)}`);
  await expect(page.getByText("one.png")).toBeVisible();
  await page.getByRole("button", { name: "Tools" }).click();
  await page.getByRole("menuitem", { name: /Edit captions/ }).click();
  const dialog = page.getByRole("alertdialog", { name: "Start edit captions?" });
  await dialog.getByLabel("Edit instruction").fill("Rewrite in present tense.");
  const preview = dialog
    .locator(".confirm-dialog__actions")
    .getByRole("button", { name: "Dry run" });
  await preview.focus();
  await preview.press("Enter");
  const samples = dialog.getByRole("status");
  await expect(samples.getByRole("listitem")).toHaveCount(3, { timeout: 30_000 });
  await expect(samples).toContainText("four.png");
  await expect(samples).toContainText("one.png");
  await expect(samples).toContainText("three.png");
  await expect(samples.locator("del").first()).toBeVisible();
  await expect(samples.locator("ins").first()).toBeVisible();
  for (const name of names) {
    expect(fs.readFileSync(path.join(folder, `${name}.txt`), "utf-8")).toBe(original);
  }
  expect(fs.existsSync(path.join(folder, ".backup"))).toBe(false);
  const requests = readModelRequests().slice(requestCount);
  expect(requests).toHaveLength(3);
  for (const request of requests) {
    expect(systemText(request)).toContain("Rewrite in present tense.");
    expect(imageParts(request)).toHaveLength(0);
  }
  await samples.getByRole("listitem").last().scrollIntoViewIfNeeded();
  await expect(dialog.getByRole("button", { name: "Start edit captions" })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("preview-1024.png") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await dialog.getByLabel("Edit instruction").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("preview-1440.png") });

  await dialog.getByLabel("Edit instruction").fill("Remove colour words.");
  await expect(samples.getByRole("listitem")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Start edit captions" }).click();
  await expect(dialog).not.toBeVisible();
  await expectJobCompleted(page, "Edit captions", 30_000);
  for (const name of names) {
    expect(fs.readFileSync(path.join(folder, `${name}.txt`), "utf-8")).not.toBe(original);
    expect(fs.readFileSync(path.join(folder, ".backup", `${name}.txt`), "utf-8")).toBe(original);
  }
});
