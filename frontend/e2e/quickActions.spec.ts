import { expect, test } from "@playwright/test";
import { openWorkspace } from "./workspace";

test("quick-action navigation hints align", async ({ page }, testInfo) => {
  await openWorkspace(page);
  // The shortcut is ignored until the workspace has loaded.
  await expect(page.getByRole("button", { name: "View photo.png", exact: true })).toBeVisible();
  await page.keyboard.press("Control+p");
  const palette = page.getByRole("dialog", { name: "Quick actions" });
  await palette.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  const hint = palette.locator(".quick-action__hint > span").first();
  const hintBox = (await hint.boundingBox())!;
  for (const key of await hint.locator(".kbd").all()) {
    const box = (await key.boundingBox())!;
    expect(Math.abs(box.y + box.height / 2 - (hintBox.y + hintBox.height / 2))).toBeLessThan(1);
  }
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("quick-actions.png") });
});
