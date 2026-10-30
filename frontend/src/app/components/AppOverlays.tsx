import { AutomationDialogOverlays } from "@/features/automation/components/AutomationDialogOverlays";
import { CreateFolderDialog } from "@/features/folder/components/CreateFolderDialog";
import { FileImportOverwriteDialog } from "@/features/folder/components/FileImportOverwriteDialog";
import { QuickActionDialog } from "@/features/quickAction/components/QuickActionDialog";
import { GalleryItemDialog } from "@/features/gallery/components/GalleryItemDialog";
import { useGallerySelectionContext } from "@/features/gallery/context/GallerySelectionContext";
import { IssueResolverDialog } from "@/features/gallery/components/IssueResolverDialog";
import { JOB_START_CONFIRM } from "@/features/jobs/lib/jobMeta";
import { JobsDialog } from "@/features/jobs/components/JobsDialog";
import { DuplicateResolverDialog } from "@/features/gallery/components/DuplicateResolverDialog";
import { CandidateReviewDialog } from "@/features/gallery/components/CandidateReviewDialog";
import { FolderInstructionsDialog } from "@/features/gallery/components/FolderInstructionsDialog";
import { SelectionActionOverlays } from "@/features/gallery/components/SelectionActionOverlays";
import { SidecarSweepDialog } from "@/features/gallery/components/SidecarSweepDialog";
import { SettleAllCandidatesDialog } from "@/features/gallery/components/SettleAllCandidatesDialog";
import { StatsDialog } from "@/features/gallery/components/StatsDialog";
import { SettingsDialog } from "@/features/settings/components/SettingsDialog";
import { ShortcutsDialog } from "@/features/shortcuts/components/ShortcutsDialog";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { RenameDialog } from "@/shared/ui/RenameDialog";
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
  const { selectedPaths, toggleSelectedPath } = useGallerySelectionContext();

  return (
    <>
      <JobsDialog
        currentFolder={currentFolder}
        onOpenFolder={onOpenFolder}
        currentActions={currentJobActions}
      />

      <StatsDialog
        open={stats.open}
        items={stats.items}
        onClose={stats.onClose}
        onSearchWord={stats.onSearchWord}
      />

      <SelectionActionOverlays {...selectionActions} />

      <SidecarSweepDialog {...sidecarSweep} />

      <SettleAllCandidatesDialog {...settleAllCandidates} />

      {quickAction.open && (
        <QuickActionDialog
          items={quickAction.items}
          recentItems={quickAction.recentItems}
          onClose={quickAction.close}
        />
      )}

      {issueResolver.open && issueResolver.items.length > 0 && (
        <IssueResolverDialog
          items={issueResolver.items}
          index={issueResolver.index}
          onClose={issueResolver.onClose}
          onIndexChange={issueResolver.onIndexChange}
          onCaptionSaved={onCaptionSaved}
        />
      )}

      {duplicateResolver.open && duplicateResolver.groups.length > 0 && (
        <DuplicateResolverDialog
          groups={duplicateResolver.groups}
          index={duplicateResolver.index}
          onClose={duplicateResolver.onClose}
          onIndexChange={duplicateResolver.onIndexChange}
          deletesToTrash={duplicateResolver.deletesToTrash}
          onResolved={duplicateResolver.onResolved}
        />
      )}

      {candidateReview.open && candidateReview.entries.length > 0 && (
        <CandidateReviewDialog
          entries={candidateReview.entries}
          index={candidateReview.index}
          onClose={candidateReview.onClose}
          onIndexChange={candidateReview.onIndexChange}
          onResolved={candidateReview.onResolved}
        />
      )}

      {gallery.selectedPath && gallery.selectedIndex >= 0 && (
        <GalleryItemDialog
          suspended={instructions.open || gallery.suspended}
          focusView={gallery.focusView}
          onFocusViewChange={gallery.onFocusViewChange}
          onEditExpandedChange={gallery.onEditExpandedChange}
          transitionRef={gallery.transitionRef}
          items={gallery.dialogItems}
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
          selected={selectedPaths.has(gallery.selectedPath)}
          onToggleSelect={toggleSelectedPath}
        />
      )}

      {instructions.open && instructions.folderPath && (
        <FolderInstructionsDialog
          key={instructions.folderPath}
          folderPath={instructions.folderPath}
          onClose={instructions.onClose}
          onSaved={instructions.onSaved}
        />
      )}

      {jobStart.pending && (
        <ConfirmDialog
          title={JOB_START_CONFIRM[jobStart.pending].title}
          scope={jobStart.scope}
          description={JOB_START_CONFIRM[jobStart.pending].description()}
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

      {renameFolder && (
        <RenameDialog
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
        <ConfirmDialog
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

      {settings.open && <SettingsDialog onClose={settings.onClose} />}
      {shortcuts.open && <ShortcutsDialog onClose={shortcuts.onClose} />}
    </>
  );
}
