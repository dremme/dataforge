import { copyFile, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { WORKSPACE } from "./workspace";
import type { Page } from "@playwright/test";

async function openIssueResolver(page: Page, rules: string[] = []) {
  const folder = await mkdtemp(path.join(WORKSPACE, "issue-resolver-"));
  await copyFile(path.join(WORKSPACE, "photo.png"), path.join(folder, "landscape.png"));
  await writeFile(
    path.join(folder, "landscape.txt"),
    "A quiet lake reflects the mountains and trees along the shore. ".repeat(200),
  );
  await writeFile(
    path.join(folder, "landscape.png.issue.json"),
    JSON.stringify({ fixes: ['Replace "river" with "lake".', 'Remove "cloudy sky".'], rules }),
  );
  await page.goto(`/?path=${encodeURIComponent(folder)}`);
  await page.getByRole("button", { name: "View landscape.png", exact: true }).click();
  await page.getByRole("button", { name: "Resolve caption issue for landscape.png" }).click();
  const dialog = page.getByRole("dialog", { name: "Resolve caption issue for landscape.png" });
  await dialog.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  return dialog;
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1024, height: 600 },
]) {
  test(`long captions scroll inside the issue editor at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const dialog = await openIssueResolver(page);
    const details = dialog.locator(".issue-resolver-modal__details");
    const scroller = dialog.locator(".cm-scroller");
    await expect(scroller).toBeVisible();
    await expect
      .poll(() => details.evaluate((element) => element.scrollHeight - element.clientHeight))
      .toBe(0);
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight))
      .toBeGreaterThan(100);
    await scroller.hover();
    await page.mouse.wheel(0, 500);
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await details.evaluate((element) => element.scrollTop)).toBe(0);
    await expect(dialog.getByText("Suggested changes")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Resolve", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("issue-editor.png") });
  });
}

test("extra media height goes to the caption editor instead of stretching the issue card", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 1500 });
  await page.route("**/api/media?**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><rect width="1200" height="1200" fill="steelblue"/></svg>',
    }),
  );
  const dialog = await openIssueResolver(page);
  await expect(dialog.locator(".issue-resolver-modal__img")).toHaveJSProperty(
    "naturalHeight",
    1200,
  );
  const issues = dialog.locator(".issue-resolver-modal__issue-card");
  await expect
    .poll(() =>
      issues.evaluate((element) => {
        const style = getComputedStyle(element);
        const content = element.querySelector(".issue-resolver-modal__issue-row")!;
        return (
          element.clientHeight -
          content.getBoundingClientRect().height -
          parseFloat(style.paddingTop) -
          parseFloat(style.paddingBottom)
        );
      }),
    )
    .toBeLessThanOrEqual(1);
  await expect
    .poll(() =>
      dialog
        .locator(".issue-resolver-modal__caption-editor")
        .evaluate((element) => element.clientHeight),
    )
    .toBeGreaterThan(280);
  await expect
    .poll(() => dialog.locator(".cm-scroller").evaluate((element) => element.clientHeight))
    .toBeGreaterThan(250);
  await page.screenshot({ path: testInfo.outputPath("caption-fills-space.png") });
});

test("the issue modal grows with findings before scrolling at its viewport limit", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  let dialog = await openIssueResolver(page);
  const initialHeight = await dialog.evaluate((element: HTMLElement) => element.offsetHeight);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  dialog = await openIssueResolver(
    page,
    Array.from(
      { length: 5 },
      (_, index) =>
        `Finding ${index + 1}: Describe the mountains, trees, and reflections along the shore more precisely.`,
    ),
  );
  await expect
    .poll(() => dialog.evaluate((element: HTMLElement) => element.offsetHeight))
    .toBeGreaterThan(initialHeight + 100);
  const details = dialog.locator(".issue-resolver-modal__details");
  const issues = dialog.locator(".issue-resolver-modal__issue-card");
  const scroller = dialog.locator(".cm-scroller");
  await expect
    .poll(() => details.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBe(0);
  await expect
    .poll(() => issues.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBe(0);
  expect(await scroller.evaluate((element) => element.clientHeight)).toBeGreaterThanOrEqual(140);
  await page.screenshot({ path: testInfo.outputPath("expanded-issues.png") });

  await page.setViewportSize({ width: 1024, height: 600 });
  await expect
    .poll(() => dialog.evaluate((element: HTMLElement) => element.offsetHeight))
    .toBeLessThanOrEqual(600 * 0.92 + 1);
  await expect
    .poll(() => details.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBe(0);
  expect(await scroller.evaluate((element) => element.clientHeight)).toBeGreaterThanOrEqual(120);
  await expect
    .poll(() => issues.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(0);
  await issues.hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => issues.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await details.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(dialog.getByRole("button", { name: "Resolve", exact: true })).toBeVisible();
  await expect(scroller).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("limited-issues.png") });
});
