import type { ReactElement, ReactNode } from "react";
import {
  GallerySelectionProvider,
  type GallerySelectionValue,
} from "@/features/gallery/context/GallerySelectionContext";

const noop = () => {};

/** Wrap a subtree in a selection provider, overriding only what the test cares about. */
export function withGallerySelection(
  children: ReactNode,
  overrides: Partial<GallerySelectionValue> = {},
): ReactElement {
  return (
    <GallerySelectionProvider
      selectionMode={false}
      selectedPaths={new Set()}
      selectedCount={0}
      enterSelectionMode={noop}
      exitSelectionMode={noop}
      toggleSelectedPath={noop}
      clearSelectedPaths={noop}
      selectAllPaths={noop}
      onDeleted={noop}
      onMoved={noop}
      {...overrides}
    >
      {children}
    </GallerySelectionProvider>
  );
}
