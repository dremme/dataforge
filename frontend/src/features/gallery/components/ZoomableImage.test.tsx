import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ZoomableImage } from "./ZoomableImage";

describe("ZoomableImage", () => {
  it("zooms in on click and updates the pressed state", async () => {
    const user = userEvent.setup();
    render(<ZoomableImage src="/media/sunset.png" alt="sunset.png" />);

    const control = screen.getByRole("button", { name: "Zoom in sunset.png" });
    expect(control).toHaveAttribute("aria-pressed", "false");
    expect(control).not.toHaveClass("zoomable-image--zoomed");

    await user.click(control);

    expect(screen.getByRole("button", { name: "Zoom out sunset.png" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(control).toHaveClass("zoomable-image--zoomed");
  });

  it("zooms out on a second click", async () => {
    const user = userEvent.setup();
    render(<ZoomableImage src="/media/sunset.png" alt="sunset.png" />);

    const control = screen.getByRole("button", { name: "Zoom in sunset.png" });
    await user.click(control);
    await user.click(screen.getByRole("button", { name: "Zoom out sunset.png" }));

    expect(screen.getByRole("button", { name: "Zoom in sunset.png" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("does not zoom or expose a zoom control when zoomable is false", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ZoomableImage src="/media/sunset.png" alt="sunset.png" zoomable={false} />,
    );

    expect(screen.queryByRole("button", { name: /Zoom/i })).not.toBeInTheDocument();
    expect(container.querySelector(".zoomable-image")).toHaveClass("zoomable-image--static");

    await user.click(container.querySelector(".zoomable-image")!);
    expect(container.querySelector(".zoomable-image--zoomed")).toBeNull();
  });
});
