import type { ReactElement, ReactNode } from "react";
import {
  GallerySelectionProvider,
  type GallerySelectionValue,
} from "@/features/gallery/context/GallerySelectionContext";
import type { GallerySelectionActions } from "@/features/gallery/hooks/useGallerySelectionActions";
import { GallerySelectionHarness } from "./GallerySelectionHarness";

const noop = () => {};

/** Inert stand-in for consumers that never touch the batch actions. */
const stubActions: GallerySelectionActions = {
  busy: false,
  deleting: false,
  transferring: null,
  canAct: false,
  openDeleteConfirm: noop,
  startTransfer: noop,
  overlay: {
    currentFolder: undefined,
    selectedPaths: new Set(),
    selectedCount: 0,
    transferPicker: null,
    overwritePrompt: null,
    transferring: null,
    deleteConfirmOpen: false,
    deleting: false,
    onCloseTransferPicker: noop,
    onSelectDestination: noop,
    onConfirmOverwrite: noop,
    onCloseOverwritePrompt: noop,
    onConfirmDelete: async () => {},
    onCancelDelete: noop,
  },
};

function baseValue(overrides: Partial<GallerySelectionValue>): GallerySelectionValue {
  return {
    selectionMode: false,
    selectedPaths: new Set(),
    visibleSelectedPaths: new Set(),
    visibleSelectedCount: 0,
    enterSelectionMode: noop,
    exitSelectionMode: noop,
    toggleSelectedPath: noop,
    extendSelectionTo: noop,
    clearSelectedPaths: noop,
    selectAllPaths: noop,
    invertSelectedPaths: noop,
    onDeleted: noop,
    onMoved: noop,
    onCopied: noop,
    actions: stubActions,
    ...overrides,
  };
}

export function withGallerySelection(
  children: ReactNode,
  overrides: Partial<GallerySelectionValue> = {},
): ReactElement {
  return <GallerySelectionProvider {...baseValue(overrides)}>{children}</GallerySelectionProvider>;
}

export function withGallerySelectionActions(
  children: ReactNode,
  overrides: Partial<GallerySelectionValue> = {},
  { currentFolder }: { currentFolder: string },
): ReactElement {
  return (
    <GallerySelectionHarness value={baseValue(overrides)} currentFolder={currentFolder}>
      {children}
    </GallerySelectionHarness>
  );
}
