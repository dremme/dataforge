import path from "node:path";
import { expect, test } from "@playwright/test";
import type { FolderResponse } from "../src/shared/types";
import { WORKSPACE } from "./workspace";

for (const width of [1440, 768]) {
  test(`candidate and duplicate comparisons use the available space at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    let root: FolderResponse;
    await page.route("**/api/folders/contents?**", async (route) => {
      const folderPath = new URL(route.request().url()).searchParams.get("path");
      if (folderPath === path.join(WORKSPACE, "staging")) {
        await route.fulfill({ json: { ...root, path: folderPath, items: [root.items[0]] } });
        return;
      }
      const response = await route.fetch();
      const folder = (await response.json()) as FolderResponse;
      const photo = folder.items.find((item) => item.name === "photo.png")!;
      const first = {
        ...photo,
        has_candidate: true,
        candidate_name: "photo.png",
        duplicate_group: "similar-images",
        has_duplicate_file: true,
        width: 1200,
        height: 1200,
      };
      root = {
        ...folder,
        items: [
          first,
          {
            ...first,
            name: "reference.png",
            path: path.join(WORKSPACE, "reference.png"),
            has_candidate: false,
            candidate_name: null,
          },
        ],
        subfolders: [],
        subfolder_count: 0,
      };
      await route.fulfill({ json: root });
    });
    await page.route("**/api/duplicates?**", (route) =>
      route.fulfill({
        json: {
          folder: WORKSPACE,
          groups: [
            { group: "similar-images", max_distance: 0, threshold: "near", members: root.items },
          ],
          stale: [],
          deletes_to_trash: true,
        },
      }),
    );
    await page.route("**/api/media?**", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><rect width="1200" height="1200" fill="steelblue"/></svg>',
      }),
    );
    await page.goto(`/?path=${encodeURIComponent(WORKSPACE)}`);
    await page.getByRole("button", { name: /^Review/ }).click();
    await page.getByRole("menuitem", { name: /^Pending candidates/ }).click();
    const candidate = page.locator(".candidate-review-modal__panel");
    await expect(candidate).toBeVisible();
    const candidateStage = (await candidate
      .locator(".candidate-review-modal__stage")
      .first()
      .boundingBox())!;
    expect(candidateStage.height).toBeGreaterThan(width >= 1000 ? 600 : 300);
    const meta = (await candidate.locator(".candidate-review-modal__meta").boundingBox())!;
    const footer = (await candidate.locator(".candidate-review-modal__footer").boundingBox())!;
    expect(Math.abs(meta.y + meta.height - footer.y)).toBeLessThan(1);
    await expect(candidate.getByRole("button", { name: "Accept", exact: true })).toBeVisible();
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath("candidate.png") });
    await candidate.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: /^Review/ }).click();
    await page.getByRole("menuitem", { name: /^Duplicate groups/ }).click();
    const duplicates = page.locator(".duplicate-resolver-modal__panel");
    await expect(duplicates).toBeVisible();
    const duplicateStage = (await duplicates
      .locator(".duplicate-resolver-modal__card-stage")
      .first()
      .boundingBox())!;
    expect(duplicateStage.height).toBeGreaterThan(500);
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath("duplicates.png") });
  });
}

test("a large duplicate group wraps into balanced rows that fill the panel", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  let members: FolderResponse["items"] = [];
  await page.route("**/api/folders/contents?**", async (route) => {
    const folder = (await (await route.fetch()).json()) as FolderResponse;
    const photo = folder.items.find((item) => item.name === "photo.png")!;
    members = Array.from({ length: 6 }, (_, index) => ({
      ...photo,
      name: `copy-${index}.png`,
      path: path.join(WORKSPACE, `copy-${index}.png`),
      duplicate_group: "copies",
      has_duplicate_file: true,
    }));
    await route.fulfill({
      json: { ...folder, items: members, subfolders: [], subfolder_count: 0 },
    });
  });
  await page.route("**/api/duplicates?**", (route) =>
    route.fulfill({
      json: {
        folder: WORKSPACE,
        groups: [{ group: "copies", max_distance: 0, threshold: "near", members }],
        stale: [],
        deletes_to_trash: true,
      },
    }),
  );
  await page.goto(`/?path=${encodeURIComponent(WORKSPACE)}`);
  await page.getByRole("button", { name: /^Review/ }).click();
  await page.getByRole("menuitem", { name: /^Duplicate groups/ }).click();
  const panel = page.locator(".duplicate-resolver-modal__panel");
  await expect(panel).toBeVisible();
  // The entrance animation scales the panel; measure its resting layout.
  await panel.evaluate((element) => {
    for (const animation of element.getAnimations({ subtree: true })) animation.finish();
  });
  const cards = await panel.locator(".duplicate-resolver-modal__card").all();
  const boxes = await Promise.all(cards.map(async (card) => (await card.boundingBox())!));
  const rows = new Set(boxes.map((box) => Math.round(box.y)));
  const columns = new Set(boxes.map((box) => Math.round(box.x)));
  expect([rows.size, columns.size]).toEqual([2, 3]);
  // Both rows fit the panel, so nothing scrolls and each file is large enough to compare.
  const body = panel.locator(".duplicate-resolver-modal__body");
  expect(await body.evaluate((node) => node.scrollHeight <= node.clientHeight)).toBe(true);
  const stages = await panel.locator(".duplicate-resolver-modal__card-stage").all();
  const heights = await Promise.all(
    stages.map(async (stage) => (await stage.boundingBox())!.height),
  );
  expect(Math.min(...heights)).toBeGreaterThan(250);
  // The suggested keeper's label must not shorten its picture against the rest of the row.
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("six-duplicates.png"),
  });
});
