import {
  IMPORT_EXTENSION_SET,
  SYSPROMPT_FILENAME,
} from "@/features/folder/constants/importExtensions";

export function isImportableFileName(name: string): boolean {
  if (name === SYSPROMPT_FILENAME) {
    return true;
  }

  const dot = name.lastIndexOf(".");
  if (dot === -1) {
    return false;
  }

  return IMPORT_EXTENSION_SET.has(name.slice(dot).toLowerCase());
}

export function filterImportableFiles(files: FileList | File[]): File[] {
  const list = Array.from(files);
  return list.filter((file) => isImportableFileName(file.name));
}
