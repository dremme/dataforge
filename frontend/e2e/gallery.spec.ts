import path from "node:path";
import { expect, test } from "@playwright/test";
import type { FolderResponse } from "../src/shared/types";
import { WORKSPACE, openWorkspace } from "./workspace";

test("keeps a large filtered gallery virtualized while inspecting media", async ({
  page,
}, testInfo) => {
  await page.route("**/api/folders/contents?**", async (route) => {
    const response = await route.fetch();
    const folder = (await response.json()) as FolderResponse;
    const original = folder.items.find((item) => item.name === "photo.png")!;
    const items = Array.from({ length: 2000 }, (_, index) => ({
      ...original,
      path: path.join(WORKSPACE, `image-${index}.png`),
      name: `image-${index}.png`,
    }));
    await route.fulfill({ json: { ...folder, items, item_count: items.length } });
  });
  await page.goto(`/?path=${encodeURIComponent(WORKSPACE)}`);
  await expect(page.getByRole("button", { name: "View image-0.png", exact: true })).toBeVisible();
  await expect(page.locator(".gallery-section__header")).not.toHaveClass(/--floating/);
  expect(await page.locator(".card").count()).toBeLessThan(2000);
  await page.locator(".card").first().click();
  await expect(page.locator(".gallery-item-modal--inline")).toBeVisible();
  await page.locator(".main").evaluate((node) => {
    node.scrollTop = 15000;
  });
  await expect(page.locator(".main")).toHaveJSProperty("scrollTop", 15000);
  await expect(page.locator(".gallery-section__header")).toHaveClass(/--floating/);
  expect(await page.locator(".card").count()).toBeLessThan(2000);
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("toolbar-floating.png"),
  });
  await page.locator(".main").evaluate((node) => {
    node.scrollTop = 0;
  });
  await expect(page.locator(".main")).toHaveJSProperty("scrollTop", 0);
  await expect(page.locator(".gallery-section__header")).not.toHaveClass(/--floating/);
  await expect
    .poll(() =>
      page
        .locator(".gallery-section__header")
        .evaluate((node) => getComputedStyle(node, "::before").getPropertyValue("visibility")),
    )
    .toBe("hidden");
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("toolbar-flat.png") });
  await page.keyboard.press("Control+f");
  await page
    .getByRole("searchbox", { name: "Search files and folders by name or caption" })
    .fill("image-1999.png");
  await expect(
    page.getByRole("button", { name: "View image-1999.png", exact: true }),
  ).toBeVisible();
});

test("entering selection mode keeps the gallery in place", async ({ page }) => {
  await openWorkspace(page);
  // The loading skeleton also renders .card placeholders; measure the loaded gallery.
  await expect(page.getByRole("button", { name: "View photo.png", exact: true })).toBeVisible();
  await expect(page.locator(".gallery--skeleton")).toHaveCount(0);
  const offset = () =>
    page.evaluate(() => {
      const header = document.querySelector(".gallery-section__header")!.getBoundingClientRect();
      const card = document.querySelector(".card")!.getBoundingClientRect();
      return { height: header.height, gap: Math.round(card.y - header.y) };
    });
  const before = await offset();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await expect(page.getByRole("button", { name: "Exit selection mode" })).toBeVisible();
  expect(await offset()).toEqual(before);
});
