import { AutomationModalOverlays } from "@/features/automation/components/AutomationModalOverlays";
import { CreateFolderModal } from "@/features/folder/components/CreateFolderModal";
import { FileImportOverwriteModal } from "@/features/folder/components/FileImportOverwriteModal";
import { QuickActionModal } from "@/features/quickAction/components/QuickActionModal";
import { GalleryItemModal } from "@/features/gallery/components/GalleryItemModal";
import { IssueResolverModal } from "@/features/gallery/components/IssueResolverModal";
import { JOB_START_CONFIRM } from "@/features/jobs/lib/jobMeta";
import { JobsModal } from "@/features/jobs/components/JobsModal";
import { DuplicateResolverModal } from "@/features/gallery/components/DuplicateResolverModal";
import { CandidateReviewModal } from "@/features/gallery/components/CandidateReviewModal";
import { FolderInstructionsModal } from "@/features/gallery/components/FolderInstructionsModal";
import { SelectionActionOverlays } from "@/features/gallery/components/SelectionActionOverlays";
import { SidecarSweepModal } from "@/features/gallery/components/SidecarSweepModal";
import { SettleAllCandidatesModal } from "@/features/gallery/components/SettleAllCandidatesModal";
import { StatsModal } from "@/features/gallery/components/StatsModal";
import { SettingsModal } from "@/features/settings/components/SettingsModal";
import { ShortcutsModal } from "@/features/shortcuts/components/ShortcutsModal";
import { ConfirmModal } from "@/shared/ui/ConfirmModal";
import { RenameModal } from "@/shared/ui/RenameModal";
import type { AppOverlaysProps } from "./overlays";

export function AppOverlays({
  currentJobActions,
  currentFolder,
  onOpenFolder,
  quickAction,
  selectionActions,
  sidecarSweep,
  settleAllCandidates,
  onCaptionSaved,
  gallery,
  issueResolver,
  instructions,
  stats,
  duplicateResolver,
  candidateReview,
  jobStart,
  automation,
  fileImport,
  createFolder,
  renameFolder,
  deleteFolder,
  settings,
  shortcuts,
}: AppOverlaysProps) {
  return (
    <>
      <JobsModal
        currentFolder={currentFolder}
        onOpenFolder={onOpenFolder}
        currentActions={currentJobActions}
      />

      <StatsModal
        open={stats.open}
        items={stats.items}
        onClose={stats.onClose}
        onSearchWord={stats.onSearchWord}
      />

      <SelectionActionOverlays {...selectionActions} />

      <SidecarSweepModal {...sidecarSweep} />

      <SettleAllCandidatesModal {...settleAllCandidates} />

      {quickAction.open && (
        <QuickActionModal
          items={quickAction.items}
          recentItems={quickAction.recentItems}
          onClose={quickAction.close}
        />
      )}

      {issueResolver.open && issueResolver.items.length > 0 && (
        <IssueResolverModal
          items={issueResolver.items}
          index={issueResolver.index}
          onClose={issueResolver.onClose}
          onIndexChange={issueResolver.onIndexChange}
          onCaptionSaved={onCaptionSaved}
        />
      )}

      {duplicateResolver.open && duplicateResolver.groups.length > 0 && (
        <DuplicateResolverModal
          groups={duplicateResolver.groups}
          index={duplicateResolver.index}
          onClose={duplicateResolver.onClose}
          onIndexChange={duplicateResolver.onIndexChange}
          deletesToTrash={duplicateResolver.deletesToTrash}
          onResolved={duplicateResolver.onResolved}
        />
      )}

      {candidateReview.open && candidateReview.entries.length > 0 && (
        <CandidateReviewModal
          entries={candidateReview.entries}
          index={candidateReview.index}
          onClose={candidateReview.onClose}
          onIndexChange={candidateReview.onIndexChange}
          onResolved={candidateReview.onResolved}
        />
      )}

      {gallery.selectedPath && gallery.selectedIndex >= 0 && (
        <GalleryItemModal
          suspended={instructions.open || gallery.suspended}
          focusView={gallery.focusView}
          onFocusViewChange={gallery.onFocusViewChange}
          onEditExpandedChange={gallery.onEditExpandedChange}
          transitionRef={gallery.transitionRef}
          items={gallery.modalItems}
          index={gallery.selectedIndex}
          searchQuery={gallery.searchQuery}
          searchRegex={gallery.searchRegex}
          hasCaptionBackup={gallery.hasCaptionBackup}
          currentFolder={currentFolder}
          onClose={gallery.onClose}
          onPrevious={gallery.onPrevious}
          onNext={gallery.onNext}
          onGoTo={gallery.onGoTo}
          onCaptionSaved={onCaptionSaved}
          onDeleted={gallery.onDeleted}
          onRenamed={gallery.onRenamed}
          onMoved={gallery.onMoved}
          onCopied={gallery.onCopied}
          onResolveIssue={gallery.onResolveIssue}
          onReviewCandidate={gallery.onReviewCandidate}
          onResolveDuplicate={gallery.onResolveDuplicate}
        />
      )}

      {instructions.open && instructions.folderPath && (
        <FolderInstructionsModal
          key={instructions.folderPath}
          folderPath={instructions.folderPath}
          onClose={instructions.onClose}
          onSaved={instructions.onSaved}
        />
      )}

      {jobStart.pending && (
        <ConfirmModal
          title={JOB_START_CONFIRM[jobStart.pending].title}
          scope={jobStart.scope}
          description={JOB_START_CONFIRM[jobStart.pending].description()}
          confirmLabel={JOB_START_CONFIRM[jobStart.pending].confirmLabel}
          onConfirm={jobStart.onConfirm}
          onCancel={jobStart.onCancel}
        />
      )}

      <AutomationModalOverlays modals={automation} />

      {fileImport.overwritePrompt && (
        <FileImportOverwriteModal
          conflicts={fileImport.overwritePrompt.conflicts}
          busy={fileImport.busy}
          onReplaceExisting={fileImport.onReplaceExisting}
          onCopyNewOnly={fileImport.onCopyNewOnly}
          onCancel={fileImport.onCancel}
        />
      )}

      {createFolder && (
        <CreateFolderModal
          parentLabel={createFolder.parentLabel}
          busy={createFolder.busy}
          error={createFolder.error}
          onConfirm={createFolder.onConfirm}
          onCancel={createFolder.onCancel}
        />
      )}

      {renameFolder && (
        <RenameModal
          title="Rename folder"
          description={
            <>
              Give the empty folder <strong>{renameFolder.folderName}</strong> another name.
            </>
          }
          fieldLabel="Folder name"
          initialName={renameFolder.folderName}
          busy={renameFolder.busy}
          error={renameFolder.error}
          onConfirm={renameFolder.onConfirm}
          onCancel={renameFolder.onCancel}
        />
      )}

      {deleteFolder && (
        <ConfirmModal
          title="Delete this folder?"
          description={
            <>
              <strong>{deleteFolder.folderLabel}</strong> is empty. On Windows, it is moved to the
              Recycle Bin.
            </>
          }
          confirmLabel={deleteFolder.busy ? "Deleting..." : "Delete"}
          confirmVariant="danger"
          busy={deleteFolder.busy}
          onConfirm={() => {
            void deleteFolder.onConfirm();
          }}
          onCancel={deleteFolder.onCancel}
        />
      )}

      {settings.open && <SettingsModal onClose={settings.onClose} />}
      {shortcuts.open && <ShortcutsModal onClose={shortcuts.onClose} />}
    </>
  );
}
