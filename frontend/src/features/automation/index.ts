export { AutomationDialogOverlays } from "./components/AutomationDialogOverlays";
export { AutomationPanel } from "./components/AutomationPanel";
export type { AutomationPanelProps } from "./components/AutomationPanel";
export type { AutoCaptionMode } from "./components/AutoCaptionDialog";
export type { VerifyCaptionsMode } from "./components/VerifyCaptionsDialog";

export { useAutomationDialogOverlays } from "./hooks/useAutomationDialogOverlays";
export { useAutomationHost } from "./hooks/useAutomationHost";
export { useFolderAutomation } from "./hooks/useFolderAutomation";

export type { BodyPartsSettings } from "./preferences/bodyPartsPreferences";

export type { AutomationDialogsState, FolderBusyDialogState } from "./types";

export {
  fetchSystemSpecs,
  startAutoCaptionJob,
  startBatchRenameJob,
  startBodyPartsJob,
  startSetCaptionsJob,
  startStripMetadataJob,
  startVerifyCaptionsJob,
} from "./api";
