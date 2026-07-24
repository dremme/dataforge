/** True when the drag carries importable files from outside the app UI. */
export function isExternalFileDrag(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types);
  if (!types.includes("Files")) {
    return false;
  }

  // Drags from in-page <img> elements include text/html alongside Files.
  if (types.includes("text/html")) {
    return false;
  }

  return true;
}
