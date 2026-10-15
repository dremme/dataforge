import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import type { FolderResponse } from "../src/shared/types";
import { WORKSPACE, openWorkspace } from "./workspace";

async function screenshotPixels(
  page: Page,
  points: number[][],
  animations: "allow" | "disabled" = "disabled",
) {
  const png = (await page.screenshot({ animations })).toString("base64");
  return page.evaluate(
    async ({ png, points }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      return points.map(([x, y]) =>
        [...context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data].slice(0, 3),
      );
    },
    { png, points },
  );
}

test("inspected cards keep a two-pixel border over the preview", async ({ page }, testInfo) => {
  await openWorkspace(page);
  const card = page.getByRole("button", { name: "View clip.mp4", exact: true });
  await expect(card.locator(".card__img--ready")).toBeVisible();
  await card.click();
  await page.mouse.move(0, 0);
  await expect(card).toHaveAttribute("data-inspected");
  for (const mode of ["Small cards", "Large cards"]) {
    await page.getByRole("button", { name: "Display mode", exact: true }).click();
    await page.getByRole("menuitemradio", { name: mode, exact: true }).click();
    await page.mouse.move(0, 0);
    await expect(card.locator(".card__img--ready")).toBeVisible();
    await card.evaluate((node) => node.style.setProperty("--accent", "rgb(255, 0, 0)"));
    for (const hovered of [false, true]) {
      if (hovered) await card.hover();
      const box = (await card.boundingBox())!;
      const media = (await card.locator(".card__media").boundingBox())!;
      const body = (await card.locator(".card__body").boundingBox())!;
      const points = [media.y + media.height / 2, body.y + body.height / 2].flatMap((y) => [
        [box.x, y],
        [box.x + 1, y],
        [box.x + box.width - 1, y],
        [box.x + box.width - 2, y],
      ]);
      const pixels = await screenshotPixels(page, points);
      expect(pixels).toEqual(points.map(() => [255, 0, 0]));
      await page.screenshot({
        path: testInfo.outputPath(`${mode}-${hovered}.png`),
        animations: "disabled",
      });
    }
  }
});

test("rounded video thumbnails fill large previews to the bottom edge", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.route("**/api/folders/contents?**", async (route) => {
    const folder = (await (await route.fetch()).json()) as FolderResponse;
    const items = folder.items
      .filter((item) => item.name === "clip.mp4")
      .map((item) => ({
        ...item,
        width: 640,
        height: 366,
        description: null,
        has_description: false,
        has_caption_file: false,
        caption_status: "none" as const,
      }));
    await route.fulfill({
      json: { ...folder, items, item_count: items.length, subfolders: [], subfolder_count: 0 },
    });
  });
  // Video thumbnail scaling rounds the height to an even number of pixels.
  await page.route("**/api/thumbnail?**", async (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="228"><path fill="#4682b4" d="M0 0h400v228H0z"/></svg>',
    }),
  );
  await page.goto(`/?path=${encodeURIComponent(WORKSPACE)}`);
  const card = page.getByRole("button", { name: "View clip.mp4", exact: true });
  await expect(card.locator(".card__img--ready")).toBeVisible();
  await card.evaluate((node) => node.style.setProperty("--bg-media", "black"));
  const media = (await card.locator(".card__media").boundingBox())!;
  const pixels = await screenshotPixels(page, [
    [media.x + media.width / 2, Math.ceil(media.y + media.height) - 1],
  ]);
  await page.screenshot({
    path: testInfo.outputPath("video-thumbnail-edge.png"),
    animations: "disabled",
  });
  expect(pixels).toEqual([[70, 130, 180]]);
});

test("video playback keeps the fading overlay even along the preview edge", async ({
  page,
}, testInfo) => {
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
  const clip = execFileSync(ffmpeg, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=steelblue:s=64x64:r=30",
    "-t",
    "2",
    "-c:v",
    "libx264",
    "-an",
    "-movflags",
    "frag_keyframe+empty_moov",
    "-f",
    "mp4",
    "pipe:1",
  ]);
  await page.route("**/api/media?**", (route) =>
    route.fulfill({ contentType: "video/mp4", body: clip }),
  );
  await page.route("**/api/folders/contents?**", async (route) => {
    const folder = (await (await route.fetch()).json()) as FolderResponse;
    const items = folder.items
      .filter((item) => item.name === "clip.mp4")
      .map((item) => ({
        ...item,
        description: null,
        has_description: false,
        has_caption_file: false,
        caption_status: "none" as const,
      }));
    await route.fulfill({
      json: { ...folder, items, item_count: 1, subfolders: [], subfolder_count: 0 },
    });
  });
  // Pause the fade as it starts so screenshots can inspect intermediate playback frames.
  await page.addInitScript(() => {
    document.addEventListener(
      "playing",
      (event) => {
        const card = (event.target as Element).closest(".card");
        if (!card) return;
        requestAnimationFrame(() => {
          for (const animation of card.getAnimations({ subtree: true })) animation.pause();
        });
      },
      true,
    );
  });
  await page.setViewportSize({ width: 1202, height: 900 });
  await page.goto(`/?path=${encodeURIComponent(WORKSPACE)}`);
  const card = page.getByRole("button", { name: "View clip.mp4", exact: true });
  await expect(card.locator(".card__img--ready")).toBeVisible();
  await card.hover();
  await expect(card).toHaveClass(/card--previewing/);
  await expect
    .poll(() =>
      card.evaluate((node) =>
        node.getAnimations({ subtree: true }).some((animation) => animation.playState === "paused"),
      ),
    )
    .toBe(true);
  const media = (await card.locator(".card__media").boundingBox())!;
  const x = media.x + media.width / 2;
  const bottom = Math.round(media.y + media.height) - 1;
  for (const time of [0, 60, 150, 200]) {
    await card.evaluate((node, time) => {
      for (const animation of node.getAnimations({ subtree: true })) animation.currentTime = time;
    }, time);
    const pixels = await screenshotPixels(
      page,
      [
        [x, bottom],
        [x, bottom - 3],
      ],
      "allow",
    );
    expect(pixels[0]).toEqual(pixels[1]);
    await page.screenshot({ path: testInfo.outputPath(`playback-fade-${time}.png`) });
  }
});

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
    .getByRole("searchbox", { name: "Search files and folders by name, caption or tag" })
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

test("large cards show whole tags only and count the rest", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  const tags = Array.from({ length: 12 }, (_, index) => ({
    label: `tag number ${index + 1}`,
    confidence: 0.9 - index * 0.05,
  }));
  await page.route("**/api/folders/contents?**", async (route) => {
    const folder = (await (await route.fetch()).json()) as FolderResponse;
    const items = folder.items
      .filter((item) => item.name === "photo.png" || item.name === "clip.mp4")
      .map((item) => ({ ...item, tags }));
    await route.fulfill({
      json: { ...folder, items, item_count: items.length, subfolders: [], subfolder_count: 0 },
    });
  });
  await page.goto(`/?path=${encodeURIComponent(WORKSPACE)}`);
  await expect(page.locator(".card--large .card__tags-more").first()).toBeVisible();

  const cards = await page.locator(".card--large").evaluateAll((nodes) =>
    nodes.map((card) => {
      const list = card.querySelector(".card__tag-list")!.getBoundingClientRect();
      const tags = Array.from(card.querySelectorAll(".card__tag"), (tag) =>
        tag.getBoundingClientRect(),
      );
      const visible = tags.filter((tag) => tag.top < list.bottom - 0.5);
      const cell = card.closest<HTMLElement>(".gallery-masonry-item")!;
      return {
        sticksOut: visible.filter((tag) => tag.right > list.right + 0.5).length,
        hidden: tags.length - visible.length,
        more: card.querySelector(".card__tags-more")?.textContent ?? "",
        heightOff: Math.abs(card.getBoundingClientRect().height - parseFloat(cell.style.height)),
      };
    }),
  );
  expect(cards).toHaveLength(2);
  for (const card of cards) {
    expect(card.sticksOut).toBe(0);
    expect(card.hidden).toBeGreaterThan(0);
    expect(card.more).toBe(`+${card.hidden} more`);
    expect(card.heightOff).toBeLessThan(1);
  }

  // The pill's tooltip replaces the card's name, and the name returns once the pointer does.
  const card = page.getByRole("button", { name: "View photo.png", exact: true });
  await card.locator(".card__title").hover();
  await expect(page.getByRole("tooltip")).toHaveText("photo.png");
  await card.locator(".card__tags-more").hover();
  await expect(page.getByRole("tooltip")).toHaveText(/^tag number \d+(, tag number \d+)*$/);
  await card.locator(".card__title").hover();
  await expect(page.getByRole("tooltip")).toHaveText("photo.png");
});
