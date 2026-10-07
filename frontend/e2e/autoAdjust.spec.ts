import path from "node:path";
import { expect, test } from "@playwright/test";
import type { ImageEditStateResponse } from "../src/shared/types";
import { WORKSPACE, expectJobCompleted } from "./workspace";

test.afterEach(async ({ request }) => {
  const media = path.join(WORKSPACE, "photo.png");
  await request.post(`/api/media/image-edit/revert?path=${encodeURIComponent(media)}`);
});

test("resets only color adjustments through the auto-adjust dialog", async ({ page }, testInfo) => {
  const media = path.join(WORKSPACE, "photo.png");
  const editUrl = `/api/media/image-edit?path=${encodeURIComponent(media)}`;
  const crop = { x: 0, y: 0, width: 0.5, height: 1 };
  const response = await page.request.post(editUrl, {
    data: {
      crop,
      mirror_h: true,
      adjust: { exposure: 0.3, tint: 0.2 },
      auto_adjust: { amount: 1, suggestion: { exposure: 0.3 } },
    },
  });
  expect(response.ok()).toBe(true);

  await page.goto(`/?path=${encodeURIComponent(WORKSPACE)}`);
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Auto-adjust / }).click();
  const dialog = page.getByRole("alertdialog");
  const replace = dialog.getByRole("checkbox", { name: "Replace earlier adjustments" });
  const reset = dialog.getByRole("checkbox", { name: "Reset all color adjustments to zero" });
  await expect(reset).not.toBeChecked();
  await page.screenshot({ path: testInfo.outputPath("auto-adjust.png"), animations: "disabled" });
  await dialog.getByText("Replace earlier adjustments", { exact: true }).click();
  await expect(replace).toBeChecked();
  await dialog.getByText("Reset all color adjustments to zero", { exact: true }).click();
  await expect(reset).toBeChecked();
  await expect(replace).toBeDisabled();
  await expect(dialog).toHaveAccessibleName("Reset color adjustments?");
  await page.screenshot({ path: testInfo.outputPath("reset-color.png"), animations: "disabled" });

  const queued = page.waitForRequest("**/api/automation/auto-adjust?**");
  await dialog.getByRole("button", { name: "Reset color adjustments", exact: true }).click();
  expect((await queued).postDataJSON()).toMatchObject({
    replace_adjustments: false,
    reset_adjustments: true,
  });
  await expectJobCompleted(page, "Auto-adjust", 30_000);

  const state = (await (await page.request.get(editUrl)).json()) as ImageEditStateResponse;
  expect(state.spec?.crop).toEqual(crop);
  expect(state.spec?.mirror_h).toBe(true);
  expect(state.spec?.auto_adjust).toBeNull();
  expect(Object.values(state.spec!.adjust).every((value) => value === 0)).toBe(true);
  expect(state.has_backup).toBe(true);
});
