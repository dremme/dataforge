import { expect, test } from "@playwright/test";
import type { NotificationRecord } from "../src/shared/types";

const notifications: NotificationRecord[] = ["success", "warning", "danger"].flatMap(
  (variant, index) =>
    [
      "Job completed.",
      "The landscape caption could not be saved. Check folder permissions and retry the operation.",
    ].map((message, messageIndex) => ({
      id: `notification-${index}-${messageIndex}`,
      message,
      variant: variant as NotificationRecord["variant"],
      source: "job",
      job_id: null,
      count: messageIndex + 1,
      created_at: "2026-01-01T00:00:00.000Z",
      read_at: null,
    })),
);

for (const fontSize of [16, 20]) {
  test(`notification icons align with the first message line at ${fontSize}px`, async ({
    page,
  }, testInfo) => {
    await page.route("**/api/notifications", (route) => route.fulfill({ json: { notifications } }));
    await page.goto("/");
    await page.evaluate((size) => {
      document.documentElement.style.fontSize = `${size}px`;
    }, fontSize);
    await page.getByRole("button", { name: "Notifications (6 new)", exact: true }).click();

    const rows = page.locator(".notifications-panel__row");
    await expect(rows).toHaveCount(notifications.length);
    await page.getByRole("group", { name: "Notifications", exact: true }).screenshot({
      path: testInfo.outputPath("notifications-panel.png"),
    });

    for (const row of await rows.all()) {
      const icon = await row.locator(".notifications-panel__row-icon").boundingBox();
      const message = row.locator(".notifications-panel__row-message");
      const messageBox = await message.boundingBox();
      const lineHeight = await message.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).lineHeight),
      );

      expect(icon).not.toBeNull();
      expect(messageBox).not.toBeNull();
      expect(Math.abs(icon!.y + icon!.height / 2 - (messageBox!.y + lineHeight / 2))).toBeLessThan(
        0.5,
      );
    }

    expect(
      (await rows.nth(1).locator(".notifications-panel__row-message").boundingBox())!.height,
    ).toBeGreaterThan(
      (await rows.first().locator(".notifications-panel__row-message").boundingBox())!.height,
    );
  });
}
