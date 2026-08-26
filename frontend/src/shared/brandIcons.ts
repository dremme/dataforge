import { createLucideIcon } from "lucide-react";

/**
 * Marks for the outside tools DataForge drives. Lucide has no brand glyphs, so these are
 * drawn here and built with `createLucideIcon` — that returns a real `LucideIcon`, so a
 * brand mark takes the same `size` / `className` / `Icon` wrapper as every other icon and
 * nothing downstream has to know it is not from the set.
 *
 * They are re-exported from `shared/icons.ts` so every component keeps one import site.
 */

/**
 * The ComfyUI "C", traced from the mark ComfyUI ships as its favicon and redrawn on
 * lucide's 24x24 grid.
 *
 * Filled rather than stroked, and that is the one place it departs from its neighbours: a
 * stroked outline of this glyph is just a letter C, which is the whole of what makes the
 * mark recognisable thrown away. It carries no colour of its own — `fill: currentColor`
 * puts it in white on a dark toolbar next to the stroke icons, instead of importing the
 * brand's yellow-on-black badge into a palette that has no room for it.
 */
export const iconComfyUi = createLucideIcon("comfy-ui", [
  [
    "path",
    {
      d: "M5.485 23.76c-.568 0-1.026-.207-1.325-.598-.307-.402-.387-.964-.22-1.54l.672-2.315a.605.605 0 00-.1-.536.622.622 0 00-.494-.243H2.085c-.568 0-1.026-.207-1.325-.598-.307-.403-.387-.964-.22-1.54l2.31-7.917.255-.87c.343-1.18 1.592-2.14 2.786-2.14h2.313c.276 0 .519-.18.595-.442l.764-2.633C9.906 1.208 11.155.249 12.35.249l4.945-.008h3.62c.568 0 1.027.206 1.325.597.307.402.387.964.22 1.54l-1.035 3.566c-.343 1.178-1.593 2.137-2.787 2.137l-4.956.01H11.37a.618.618 0 00-.594.441l-1.928 6.604a.605.605 0 00.1.537c.118.153.3.243.495.243l3.275-.006h3.61c.568 0 1.026.206 1.325.598.307.402.387.964.22 1.54l-1.036 3.565c-.342 1.179-1.592 2.138-2.786 2.138l-4.957.01h-3.61z",
      // The svg element sets `fill="none" stroke="currentColor"` for the stroke icons;
      // both have to be reversed here or the glyph renders as a hollow outline.
      fill: "currentColor",
      stroke: "none",
      key: "comfy-ui-c",
    },
  ],
]);
