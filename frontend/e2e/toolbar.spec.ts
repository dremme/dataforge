import { expect, test } from "@playwright/test";
import { openWorkspace } from "./workspace";

test("search expands on focus, retains a query on blur, and collapses when cleared", async ({
  page,
}) => {
  await openWorkspace(page);
  const field = page.locator(".toolbar__search");
  const compact = (await field.boundingBox())!.width;
  await page.keyboard.press("Control+f");
  const search = page.getByRole("searchbox", {
    name: "Search files and folders by name or caption",
  });
  await expect(search).toBeFocused();
  await expect.poll(async () => (await field.boundingBox())!.width).toBeGreaterThan(compact * 3);
  await search.fill("photo");
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await expect(search).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+f");
  await page.getByRole("button", { name: "Clear search" }).click();
  await page.getByRole("button", { name: "Filter media" }).click();
  await expect.poll(async () => (await field.boundingBox())!.width).toBeLessThan(compact + 1);
});

test("a crowded toolbar keeps one row by showing the folder actions as icons", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openWorkspace(page);
  const toolbar = page.locator(".toolbar");
  const tools = page.getByRole("button", { name: "Tools", exact: true });
  const label = tools.locator(".toolbar__collapsible-label");
  const rowTops = () =>
    toolbar.evaluate((element) =>
      [".toolbar__actions", ".toolbar__controls"].map((selector) =>
        Math.round(element.querySelector(selector)!.getBoundingClientRect().top),
      ),
    );

  await expect(label).toBeVisible();
  await expect(label).toHaveCSS("position", "static");
  const [actionsTop, controlsTop] = await rowTops();
  expect(controlsTop).toBe(actionsTop);

  // A typed query widens the search field past what the labelled actions leave.
  const search = page.getByRole("searchbox", {
    name: "Search files and folders by name or caption",
  });
  await search.fill("photo and a longer query");
  await expect(toolbar).toHaveClass(/toolbar--compact/);
  await expect(label).toHaveCSS("position", "absolute");
  await expect.poll(rowTops).toEqual([actionsTop, actionsTop]);
  for (const name of ["Edit instructions", "Auto-caption"]) {
    const box = (await page.getByRole("button", { name, exact: true }).boundingBox())!;
    expect(Math.round(box.width)).toBe(Math.round(box.height));
  }
  await page.screenshot({ path: testInfo.outputPath("toolbar-compact.png") });

  await page.getByRole("button", { name: "Clear search" }).click();
  await page.getByRole("button", { name: "Filter media" }).click();
  await page.keyboard.press("Escape");
  await expect(toolbar).not.toHaveClass(/toolbar--compact/);
  await expect(label).toHaveCSS("position", "static");
});

test("a narrowing toolbar switches to icons once, without flickering at the threshold", async ({
  page,
}) => {
  // Between the sidebar (1600px) and stats (1200px) breakpoints the row only ever narrows.
  await page.setViewportSize({ width: 1590, height: 800 });
  await openWorkspace(page);
  await page
    .getByRole("searchbox", { name: "Search files and folders by name or caption" })
    .fill("photo and a longer query");
  const toolbar = page.locator(".toolbar");
  await expect(toolbar).not.toHaveClass(/toolbar--compact/);
  await toolbar.evaluate((element) => {
    let compact = false;
    const flips = { count: 0 };
    new MutationObserver(() => {
      if (element.classList.contains("toolbar--compact") === compact) return;
      compact = !compact;
      flips.count += 1;
    }).observe(element, { attributes: true, attributeFilter: ["class"] });
    Object.assign(window, { toolbarFlips: flips });
  });

  // A mode judged on the wrong widths flips back and forth inside a band a few pixels wide.
  for (let width = 1590; width >= 1210; width -= 4) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  }

  await expect(toolbar).toHaveClass(/toolbar--compact/);
  const flips = await page.evaluate(
    () => (window as unknown as { toolbarFlips: { count: number } }).toolbarFlips.count,
  );
  expect(flips).toBe(1);
});

test("the sort control is a round menu button that names the order", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openWorkspace(page);
  const trigger = page.getByRole("button", { name: "Sort media" });
  const box = (await trigger.boundingBox())!;
  expect(Math.round(box.width)).toBe(Math.round(box.height));

  await trigger.click();
  const menu = page.getByRole("menu", { name: "Sort" });
  // The order is a saved preference shared by every spec on this backend: start from the default.
  await menu.getByRole("menuitemradio", { name: "Date modified" }).click();
  await menu.getByRole("menuitemradio", { name: "Newest first" }).click();
  await expect(menu.getByRole("menuitemradio", { name: "Newest first" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(trigger).not.toHaveClass(/toolbar__sort-menu-trigger--sorted/);
  await page.screenshot({ path: testInfo.outputPath("sort-menu.png") });
  await menu.getByRole("menuitemradio", { name: "Name" }).click();
  await expect(menu.getByRole("menuitemradio", { name: "A to Z" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.keyboard.press("Escape");

  await expect(menu).toBeHidden();
  await expect(trigger).toHaveClass(/toolbar__sort-menu-trigger--sorted/);
  await trigger.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Sorted by Name (A–Z)");

  // Leave the default behind for the specs after this one.
  await trigger.click();
  await menu.getByRole("menuitemradio", { name: "Date modified" }).click();
  await page.keyboard.press("Escape");
  await expect(trigger).not.toHaveClass(/toolbar__sort-menu-trigger--sorted/);
});

test("an invalid regular expression says so instead of matching literally", async ({
  page,
}, testInfo) => {
  await openWorkspace(page);
  const search = page.getByRole("searchbox", {
    name: "Search files and folders by name or caption",
  });
  await search.fill("photo[");
  await page.getByRole("button", { name: "Toggle regular expression search" }).click();

  await expect(search).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("tooltip")).toContainText("Invalid regular expression");
  await expect(page.getByText("Fix the pattern, or turn off regular expressions")).toBeVisible();
  await expect(page.getByRole("button", { name: "View photo.png", exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("invalid-regex.png") });

  await search.fill("photo[.]?");
  await expect(search).not.toHaveAttribute("aria-invalid");
  await expect(page.getByRole("button", { name: "View photo.png", exact: true })).toBeVisible();
});

test("search explains its icons in a tooltip", async ({ page }) => {
  await openWorkspace(page);
  await page.locator(".toolbar__search-icon").hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("Include file and folder names");
  await expect(tooltip).toContainText("Use regular expressions");
  for (const icon of await tooltip.locator("svg").all()) {
    expect((await icon.boundingBox())!.width).toBeLessThanOrEqual(12);
  }
});
