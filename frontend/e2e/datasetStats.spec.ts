import { expect, test, type Page } from "@playwright/test";
import { COUNT_UP_MS } from "../src/features/gallery/lib/countUp";
import type { FolderResponse } from "../src/shared/types";
import { WORKSPACE } from "./workspace";

async function openTimelineWorkspace(page: Page, photoCreatedAt: string, clipCreatedAt: string) {
  await page.route("**/api/folders/contents?**", async (route) => {
    const response = await route.fetch();
    const folder = (await response.json()) as FolderResponse;
    // Earlier specs add media to the shared workspace; only these two belong to this fixture.
    const items = folder.items
      .filter((item) => item.name === "photo.png" || item.name === "clip.mp4")
      .map((item) => ({
        ...item,
        created_at: item.name === "photo.png" ? photoCreatedAt : clipCreatedAt,
        modified_at: "2026-09-01T12:00:00",
      }));
    await route.fulfill({
      json: { ...folder, items, item_count: items.length, subfolders: [], subfolder_count: 0 },
    });
  });
  await page.goto(`/?path=${encodeURIComponent(WORKSPACE)}`);
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 5, 15, 12));
});

test("statistics chart media creation dates above caption length", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTimelineWorkspace(page, "2026-06-01T12:00:00", "2026-06-03T12:00:00");
  await page.getByRole("button", { name: "Open dataset statistics" }).click();

  const drawer = page.getByRole("dialog", { name: "Dataset statistics" });
  const chart = drawer.getByRole("figure", { name: "Distribution by media creation date" });
  const expectBuckets = async (labels: string[]) => {
    const buckets = chart.getByRole("term");
    await expect(buckets).toHaveCount(labels.length);
    for (const [index, label] of labels.entries()) {
      await expect(buckets.nth(index)).toHaveAttribute("title", label);
    }
  };
  await expect(chart).toBeVisible();
  const days = Array.from({ length: 30 }, (_, index) => `Jun ${index + 1}, 2026`);
  await expectBuckets(days);
  await expect(chart.getByText("Media", { exact: true })).toHaveCount(0);
  await expect(chart.getByText("Creation date", { exact: true })).toHaveCount(0);
  await expect(chart.getByText("Jun 2026", { exact: true })).toBeVisible();
  await expect(chart.locator(".stats-dialog__timeline-y-axis span")).toHaveText(["0", "1"]);
  await expect(chart).not.toContainText("Sep");
  const timeline = (await drawer.getByRole("heading", { name: "Media created" }).boundingBox())!;
  const captions = (await drawer.getByRole("heading", { name: "Caption length" }).boundingBox())!;
  expect(timeline.y).toBeLessThan(captions.y);

  const grouping = drawer.getByRole("radiogroup", { name: "Creation timeline grouping" });
  await expect(grouping.getByRole("radio", { name: "Day" })).toBeChecked();
  await grouping.getByText("Month", { exact: true }).click();
  await expect(grouping.getByRole("radio", { name: "Month" })).toBeChecked();
  await expectBuckets([
    "Jan 2026",
    "Feb 2026",
    "Mar 2026",
    "Apr 2026",
    "May 2026",
    "Jun 2026",
    "Jul 2026",
    "Aug 2026",
    "Sep 2026",
    "Oct 2026",
    "Nov 2026",
    "Dec 2026",
  ]);
  await expect(chart.getByLabel("2 files", { exact: true })).toBeVisible();
  await chart.screenshot({ path: testInfo.outputPath("creation-timeline-month.png") });
  await grouping.getByText("Year", { exact: true }).click();
  await expect(grouping.getByRole("radio", { name: "Year" })).toBeChecked();
  await expectBuckets(["2026"]);
  await grouping.getByRole("radio", { name: "Year" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(grouping.getByRole("radio", { name: "Month" })).toBeChecked();
  await page.keyboard.press("ArrowLeft");
  await expect(grouping.getByRole("radio", { name: "Day" })).toBeChecked();
  await expectBuckets(days);

  for (const width of [1280, 720, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(chart).toBeVisible();
    const bar = (await chart.locator(".stats-dialog__timeline-fill").first().boundingBox())!;
    expect(bar.height).toBeGreaterThan(bar.width);
    const label = (await chart.getByRole("term").first().boundingBox())!;
    expect(label.y).toBeGreaterThanOrEqual(bar.y + bar.height);
    const bounds = (await chart.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    const viewport = chart.locator(".stats-dialog__timeline-viewport");
    expect(await viewport.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath(`creation-timeline-${width}.png`) });
  }
  await chart.locator(".stats-dialog__timeline-fill").first().hover();
  await expect(page.getByRole("tooltip")).toHaveText("Jun 1, 2026: 1 file");
});

test("timeline tabs filter the current period and keep historical years available", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTimelineWorkspace(page, "2025-06-01T12:00:00", "2026-01-01T12:00:00");
  await page.getByRole("button", { name: "Open dataset statistics" }).click();
  const grouping = page.getByRole("radiogroup", { name: "Creation timeline grouping" });
  await expect(grouping.getByRole("radio", { name: "Month" })).toBeChecked();
  const chart = page.getByRole("figure", { name: "Distribution by media creation date" });
  await expect(chart.getByRole("term")).toHaveCount(12);
  await expect(chart.getByRole("term").first()).toHaveAttribute("title", "Jan 2026");
  await expect(chart.getByRole("img", { name: "1 file", exact: true })).toHaveCount(1);
  await grouping.getByText("Day", { exact: true }).click();

  await expect(chart.getByRole("term")).toHaveCount(30);
  await expect(chart.getByRole("term").first()).toHaveAttribute("title", "Jun 1, 2026");
  await expect(chart.getByText("No media created in this period.")).toBeVisible();
  await expect(chart.getByRole("img")).toHaveCount(0);
  await grouping.getByText("Year", { exact: true }).click();
  await expect(chart.getByRole("term")).toHaveCount(2);
  await expect(chart.getByRole("term").first()).toHaveAttribute("title", "2025");
  await expect(chart.getByRole("term").last()).toHaveAttribute("title", "2026");
  await expect(chart.getByRole("img", { name: "1 file", exact: true })).toHaveCount(2);
  await chart.screenshot({ path: testInfo.outputPath("creation-timeline-years.png") });
  await page.reload();
  await page.getByRole("button", { name: "Open dataset statistics" }).click();
  await expect(grouping.getByRole("radio", { name: "Year" })).toBeChecked();
  await expect(chart.getByRole("term")).toHaveCount(2);
});

test("timeline bars grow on opening and replay when statistics reopen", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.clock.install({ time: new Date(2026, 5, 15, 11) });
  await openTimelineWorkspace(page, "2025-06-01T12:00:00", "2026-06-01T12:00:00");
  const trigger = page.getByRole("button", { name: "Open dataset statistics" });
  await expect(trigger).toBeVisible();
  await page.clock.pauseAt(new Date(2026, 5, 15, 12));
  await trigger.click();

  const drawer = page.getByRole("dialog", { name: "Dataset statistics" });
  const chart = drawer.getByRole("figure", { name: "Distribution by media creation date" });
  const bar = chart.locator(".stats-dialog__timeline-fill").first();
  await expect(bar).toBeVisible();
  const finalHeight = (await chart.locator(".stats-dialog__timeline-value").first().boundingBox())!
    .height;
  const initialHeight = (await bar.boundingBox())!.height;
  expect(initialHeight).toBeLessThan(finalHeight / 2);
  await expect(bar.locator(".stats-dialog__timeline-count")).toHaveText("0");

  await page.clock.runFor(16 + COUNT_UP_MS / 2);
  const midwayHeight = (await bar.boundingBox())!.height;
  expect(midwayHeight).toBeGreaterThan(initialHeight);
  expect(midwayHeight).toBeLessThan(finalHeight);
  await chart.screenshot({ path: testInfo.outputPath("creation-timeline-midway.png") });

  await page.clock.runFor(COUNT_UP_MS);
  expect((await bar.boundingBox())!.height).toBeCloseTo(finalHeight, 0);
  await expect(bar.locator(".stats-dialog__timeline-count")).toHaveText("1");
  await drawer.getByRole("button", { name: "Close", exact: true }).click();
  await page.clock.runFor(250);
  await expect(drawer).toHaveCount(0);
  await trigger.click();
  await expect(bar).toBeVisible();
  expect((await bar.boundingBox())!.height).toBeLessThan(finalHeight / 2);
  await expect(bar.locator(".stats-dialog__timeline-count")).toHaveText("0");
  await page.clock.runFor(16 + COUNT_UP_MS);
  expect((await bar.boundingBox())!.height).toBeCloseTo(finalHeight, 0);
  await chart.screenshot({ path: testInfo.outputPath("creation-timeline-complete.png") });
});

test("period arrows browse months and years beside the caption", async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date(2026, 0, 31, 12));
  await page.setViewportSize({ width: 375, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTimelineWorkspace(page, "2025-12-31T12:00:00", "2026-02-28T12:00:00");
  await page.getByRole("button", { name: "Open dataset statistics" }).click();
  const grouping = page.getByRole("radiogroup", { name: "Creation timeline grouping" });
  await grouping.getByText("Day", { exact: true }).click();
  const chart = page.getByRole("figure", { name: "Distribution by media creation date" });
  await expect(chart.getByText("Jan 2026", { exact: true })).toBeVisible();
  const navigation = chart.locator(".stats-dialog__timeline-navigation");
  const note = navigation.getByText("No media created in this period.");
  await expect(note).toBeVisible();
  const noteBounds = (await note.boundingBox())!;
  const navigationBounds = (await navigation.boundingBox())!;
  expect(
    Math.abs(
      noteBounds.y + noteBounds.height / 2 - navigationBounds.y - navigationBounds.height / 2,
    ),
  ).toBeLessThan(1);
  await chart.screenshot({ path: testInfo.outputPath("creation-timeline-empty-period.png") });
  await chart.getByRole("button", { name: "Previous month" }).click();
  await expect(chart.getByText("Dec 2025", { exact: true })).toBeVisible();
  await expect(chart.getByRole("img", { name: "1 file" })).toHaveCount(1);
  await chart.getByRole("button", { name: "Next month" }).click();
  await chart.getByRole("button", { name: "Next month" }).click();
  await expect(chart.getByText("Feb 2026", { exact: true })).toBeVisible();
  await expect(chart.getByRole("term")).toHaveCount(28);
  await expect(chart.getByRole("img", { name: "1 file" })).toHaveCount(1);

  const caption = navigation.locator(":scope > span");
  const previous = (await chart.getByRole("button", { name: "Previous month" }).boundingBox())!;
  const next = (await chart.getByRole("button", { name: "Next month" }).boundingBox())!;
  const label = (await caption.boundingBox())!;
  expect(previous.x + previous.width).toBeLessThanOrEqual(label.x);
  expect(label.x + label.width).toBeLessThanOrEqual(next.x);
  await chart.getByRole("button", { name: "Next month" }).hover();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await chart.screenshot({ path: testInfo.outputPath("creation-timeline-month-navigation.png") });

  await grouping.getByText("Month", { exact: true }).click();
  await chart.getByRole("button", { name: "Previous year" }).click();
  await expect(caption).toHaveText("2025");
  await expect(chart.getByRole("term").first()).toHaveAttribute("title", "Jan 2025");
  await expect(chart.getByRole("img", { name: "1 file" })).toHaveCount(1);
  await chart.getByRole("button", { name: "Next year" }).click();
  await expect(caption).toHaveText("2026");
  await chart.screenshot({ path: testInfo.outputPath("creation-timeline-year-navigation.png") });
});
