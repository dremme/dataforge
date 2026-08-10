import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { iconImages } from "@/shared/icons";
import { SectionHeader } from "./SectionHeader";

// Layout is not observable in jsdom, so these cover the markup the sticky CSS
// hangs off; that it actually docks is manual verification.
describe("SectionHeader", () => {
  it("renders the count against the unfiltered total", () => {
    render(
      <SectionHeader section="gallery" icon={iconImages} title="Media" count={3} total={12} />,
    );

    expect(screen.getByRole("heading", { name: "Media" })).toBeInTheDocument();
    expect(screen.getByLabelText("3 of 12")).toHaveClass("gallery-section__count");
  });

  it("emits a sentinel and the sticky modifier when sticky", () => {
    const { container } = render(
      <SectionHeader section="gallery" icon={iconImages} title="Media" count={3} sticky />,
    );

    expect(container.firstElementChild).toHaveClass("sticky-sentinel");
    expect(container.querySelector(".gallery-section__header")).toHaveClass(
      "gallery-section__header--sticky",
    );
  });

  it("stays in flow when not sticky", () => {
    const { container } = render(
      <SectionHeader section="folder" icon={iconImages} title="Folders" count={2} />,
    );

    expect(container.querySelector(".sticky-sentinel")).toBeNull();
    expect(container.querySelector(".folder-section__header")).not.toHaveClass(
      "folder-section__header--sticky",
    );
  });
});
