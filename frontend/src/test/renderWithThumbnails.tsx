import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { ThumbnailProvider } from "@/features/gallery/context/ThumbnailProvider";

export function renderWithThumbnails(element: ReactElement) {
  return render(element, { wrapper: ThumbnailProvider });
}
