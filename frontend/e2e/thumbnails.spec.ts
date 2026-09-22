import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Locator, Page, Route } from "@playwright/test";
import { WORKSPACE } from "./workspace";

async function fixtureFolder() {
  await mkdir(WORKSPACE, { recursive: true });
  return mkdtemp(path.join(WORKSPACE, "thumbnails-"));
}

async function expectThumbnail(card: Locator) {
  await expect(card).toBeVisible({ timeout: 15000 });
  await expect(card.locator("img.card__img--ready")).toBeVisible({ timeout: 15000 });
  await expect
    .poll(() =>
      card
        .locator("img")
        .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true);
  await expect(card.locator(".card__media-placeholder")).toHaveCount(0);
}

async function setMode(page: Page, mode: string) {
  await page.getByRole("button", { name: "Display mode", exact: true }).click();
  await page.getByRole("menuitemradio", { name: mode, exact: true }).click();
}

for (const mode of ["Large cards", "Small cards", "List"]) {
  test(`${mode}: caption reordering and background inserts load without scrolling`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(60000);
    const folder = await fixtureFolder();
    await Promise.all(
      Array.from({ length: 120 }, async (_, index) => {
        const stem = `landscape-${String(index).padStart(3, "0")}`;
        await copyFile(path.join(WORKSPACE, "photo.png"), path.join(folder, `${stem}.png`));
        await writeFile(path.join(folder, `${stem}.txt`), "A quiet landscape. ".repeat(index + 1));
      }),
    );
    await page.goto(`/?path=${encodeURIComponent(folder)}`);
    await setMode(page, mode);
    await page.locator(".toolbar__sort-select").selectOption("caption-asc");
    await expectThumbnail(
      page.getByRole("button", { name: "View landscape-000.png", exact: true }),
    );
    const scrollTop = await page.locator("main").evaluate((main) => main.scrollTop);

    await writeFile(path.join(folder, "landscape-119.txt"), "Sky.");
    await expectThumbnail(
      page.getByRole("button", { name: "View landscape-119.png", exact: true }),
    );
    expect(await page.locator("main").evaluate((main) => main.scrollTop)).toBe(scrollTop);

    await copyFile(path.join(WORKSPACE, "photo.png"), path.join(folder, "new-frame.png"));
    await expectThumbnail(page.getByRole("button", { name: "View new-frame.png", exact: true }));
    expect(await page.locator("main").evaluate((main) => main.scrollTop)).toBe(scrollTop);
    await page.screenshot({ path: testInfo.outputPath("gallery.png") });
  });
}

test("a captured video frame loads after closing the modal without scrolling", async ({ page }) => {
  test.setTimeout(60000);
  const folder = await fixtureFolder();
  const backend = fileURLToPath(new URL("../../backend/", import.meta.url));
  const python = path.join(
    backend,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  const ffmpeg = execFileSync(
    python,
    ["-c", "from ffmpeg_bin import ffmpeg_path; print(ffmpeg_path() or '')"],
    { cwd: backend, encoding: "utf8" },
  ).trim();
  expect(ffmpeg).not.toBe("");
  execFileSync(ffmpeg, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=steelblue:s=320x180:r=10",
    "-t",
    "2",
    "-c:v",
    "libx264",
    "-an",
    path.join(folder, "landscape.mp4"),
  ]);
  const requestedThumbnails: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/thumbnail")
      requestedThumbnails.push(url.searchParams.get("path") ?? "");
  });
  await page.goto(`/?path=${encodeURIComponent(folder)}`);
  const scrollTop = await page.locator("main").evaluate((main) => main.scrollTop);
  await page.getByRole("button", { name: "View landscape.mp4", exact: true }).click();
  await page.getByRole("button", { name: "Save a frame from landscape.mp4", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save frame", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Save frame", exact: true }).click();
  await expect(page.getByText(/Saved frame as landscape_/)).toBeVisible();
  const frame = (await readdir(folder)).find((name) => name.endsWith(".jpg"));
  expect(frame).toBeDefined();
  await expect(page.locator(".gallery-virtual")).toContainText(frame!);
  await expect(page.getByRole("button", { name: "Save frame", exact: true })).toBeEnabled();
  expect(requestedThumbnails).not.toContain(path.join(folder, frame!));
  await page
    .getByRole("dialog", { name: "Viewing landscape.mp4" })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expectThumbnail(page.getByRole("button", { name: `View ${frame}`, exact: true }));
  expect(await page.locator("main").evaluate((main) => main.scrollTop)).toBe(scrollTop);
});

test("recovers transient thumbnail and original-image failures", async ({ page }) => {
  const folder = await fixtureFolder();
  await copyFile(path.join(WORKSPACE, "photo.png"), path.join(folder, "landscape.png"));
  let thumbnails = 0;
  let originals = 0;
  await page.route("**/api/thumbnail?**", async (route) => {
    thumbnails++;
    if (thumbnails === 1) await route.fulfill({ status: 503, body: "" });
    else await route.continue();
  });
  await page.route("**/api/media?**", async (route) => {
    originals++;
    await route.fulfill({ status: 503, body: "" });
  });
  await page.goto(`/?path=${encodeURIComponent(folder)}`);
  await expectThumbnail(page.getByRole("button", { name: "View landscape.png", exact: true }));
  expect(thumbnails).toBeGreaterThanOrEqual(2);
  expect(originals).toBe(1);
});

test("stops retrying permanently unreadable thumbnails", async ({ page }) => {
  test.setTimeout(60000);
  const folder = await fixtureFolder();
  await copyFile(path.join(WORKSPACE, "photo.png"), path.join(folder, "landscape.png"));
  let requests = 0;
  const fail = async (route: Route) => {
    requests++;
    await route.fulfill({ status: 503, body: "" });
  };
  await page.route("**/api/thumbnail?**", fail);
  await page.route("**/api/media?**", fail);
  await page.goto(`/?path=${encodeURIComponent(folder)}`);
  await expect.poll(() => requests, { timeout: 25000 }).toBeGreaterThanOrEqual(10);
  // Longer than the last retry delay, so a fifth round would have landed by now.
  await page.waitForTimeout(10000);
  expect(requests).toBe(10);
  const card = page.getByRole("button", { name: "View landscape.png", exact: true });
  await expect(card.locator(".card__media-placeholder")).toBeVisible();
  await expect(card.locator("img")).toHaveCount(0);
});
