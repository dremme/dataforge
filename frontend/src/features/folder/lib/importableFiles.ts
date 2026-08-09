import { IMPORT_EXTENSIONS, SYSPROMPT_FILENAME } from "@/shared/constants";

const IMPORT_EXTENSION_SET = new Set<string>(IMPORT_EXTENSIONS);

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
