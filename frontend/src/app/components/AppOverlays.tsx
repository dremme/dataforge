import { lazy, Suspense } from "react";
import { AutomationDialogOverlays } from "@/features/automation/components/AutomationDialogOverlays";
import { CreateFolderDialog } from "@/features/folder/components/CreateFolderDialog";
import { FileImportOverwriteDialog } from "@/features/folder/components/FileImportOverwriteDialog";
import { GalleryItemModal } from "@/features/gallery/components/GalleryItemModal";
import { IssueResolverModal } from "@/features/gallery/components/IssueResolverModal";
import { JOB_START_CONFIRM } from "@/features/jobs/lib/jobMeta";
import { JobsDrawer } from "@/features/jobs/components/JobsDrawer";
import { StatsDrawer } from "@/features/gallery/components/StatsDrawer";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import type { AppOverlaysProps } from "./overlays";

const SysPromptModal = lazy(() =>
  import("@/features/gallery/components/SysPromptModal").then((module) => ({
    default: module.SysPromptModal,
  })),
);

export function AppOverlays({
  currentFolder,
  onOpenFolder,
  onCaptionSaved,
  gallery,
  issueResolver,
  sysprompt,
  stats,
  jobStart,
  automation,
  fileImport,
  createFolder,
}: AppOverlaysProps) {
  return (
    <>
      <JobsDrawer currentFolder={currentFolder} onOpenFolder={onOpenFolder} />

      <StatsDrawer open={stats.open} items={stats.items} onClose={stats.onClose} />

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
          searchQuery={gallery.searchQuery}
          searchRegex={gallery.searchRegex}
          currentFolder={currentFolder}
          onClose={gallery.onClose}
          onPrevious={gallery.onPrevious}
          onNext={gallery.onNext}
          onCaptionSaved={onCaptionSaved}
          onDeleted={gallery.onDeleted}
          onMoved={gallery.onMoved}
          onCopied={gallery.onCopied}
          onResolveIssue={gallery.onResolveIssue}
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

      {createFolder && (
        <CreateFolderDialog
          parentLabel={createFolder.parentLabel}
          busy={createFolder.busy}
          error={createFolder.error}
          onConfirm={createFolder.onConfirm}
          onCancel={createFolder.onCancel}
        />
      )}
    </>
  );
}
