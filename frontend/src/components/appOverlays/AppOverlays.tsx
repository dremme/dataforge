import { lazy, Suspense } from "react";
import { JOB_START_CONFIRM } from "../../constants/jobStartConfirm";
import { ConfirmDialog } from "../ConfirmDialog";
import { FileImportOverwriteDialog } from "../FileImportOverwriteDialog";
import { GalleryItemModal } from "../GalleryItemModal";
import { IssueResolverModal } from "../IssueResolverModal";
import { JobsDrawer } from "../JobsDrawer";
import { AutomationDialogOverlays } from "./AutomationDialogOverlays";
import type { AppOverlaysProps } from "./types";

const SysPromptModal = lazy(() =>
  import("../SysPromptModal").then((module) => ({ default: module.SysPromptModal })),
);

export function AppOverlays({
  currentFolder,
  onOpenFolder,
  onCaptionSaved,
  gallery,
  issueResolver,
  sysprompt,
  jobStart,
  automation,
  fileImport,
}: AppOverlaysProps) {
  return (
    <>
      <JobsDrawer currentFolder={currentFolder} onOpenFolder={onOpenFolder} />

      {issueResolver.open && issueResolver.items.length > 0 && (
        <IssueResolverModal
          items={issueResolver.items}
          index={issueResolver.index}
          onClose={issueResolver.onClose}
          onIndexChange={issueResolver.onIndexChange}
          onCaptionSaved={onCaptionSaved}
        />
      )}

      {gallery.selectedPath && gallery.selectedIndex >= 0 && (
        <GalleryItemModal
          items={gallery.modalItems}
          index={gallery.selectedIndex}
          onClose={gallery.onClose}
          onPrevious={gallery.onPrevious}
          onNext={gallery.onNext}
          onCaptionSaved={onCaptionSaved}
          onDeleted={gallery.onDeleted}
          onJsonEditorOpenChange={gallery.onJsonEditorOpenChange}
        />
      )}

      {sysprompt.open && sysprompt.item && (
        <Suspense fallback={null}>
          <SysPromptModal
            item={sysprompt.item}
            onClose={sysprompt.onClose}
            onSaved={onCaptionSaved}
          />
        </Suspense>
      )}

      {jobStart.pending && (
        <ConfirmDialog
          title={JOB_START_CONFIRM[jobStart.pending].title}
          description={JOB_START_CONFIRM[jobStart.pending].description(jobStart.folderLabel)}
          confirmLabel={JOB_START_CONFIRM[jobStart.pending].confirmLabel}
          onConfirm={jobStart.onConfirm}
          onCancel={jobStart.onCancel}
        />
      )}

      <AutomationDialogOverlays dialogs={automation} />

      {fileImport.overwritePrompt && (
        <FileImportOverwriteDialog
          conflicts={fileImport.overwritePrompt.conflicts}
          busy={fileImport.busy}
          onReplaceExisting={fileImport.onReplaceExisting}
          onCopyNewOnly={fileImport.onCopyNewOnly}
          onCancel={fileImport.onCancel}
        />
      )}
    </>
  );
}
