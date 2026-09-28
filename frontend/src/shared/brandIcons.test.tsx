import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { iconAiToolkit, iconComfyUi } from "./brandIcons";
import { Icon } from "@/shared/ui/Icon";

describe.each([
  ["iconComfyUi", iconComfyUi],
  ["iconAiToolkit", iconAiToolkit],
])("%s", (_name, brandIcon) => {
  // Lucide sets fill="none"; miss reversing fill or stroke and the glyph is a hollow outline.
  it("draws a filled glyph rather than a stroked outline", () => {
    const { container } = render(<Icon icon={brandIcon} />);

    const path = container.querySelector("path");

    expect(path).toHaveAttribute("fill", "currentColor");
    expect(path).toHaveAttribute("stroke", "none");
  });

  it("takes the same props as a lucide icon", () => {
    const { container } = render(<Icon icon={brandIcon} spin className="job-card__icon" />);

    const svg = container.querySelector("svg");

    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg).toHaveClass("job-card__icon", "app-icon--spin");
    // `aria-hidden` comes from the Icon wrapper: every icon here is decorative, and a
    // brand mark that announced itself would be read out beside its own label.
    expect(svg).toHaveAttribute("aria-hidden");
  });
});

describe("iconAiToolkit", () => {
  it("cuts the hole out of the O whichever way its outlines wind", () => {
    const { container } = render(<Icon icon={iconAiToolkit} />);

    expect(container.querySelector("path")).toHaveAttribute("fill-rule", "evenodd");
  });
});
