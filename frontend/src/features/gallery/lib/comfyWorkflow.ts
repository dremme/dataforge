export function supportsComfyWorkflow(path: string): boolean {
  const lowerPath = path.toLowerCase();
  return lowerPath.endsWith(".png") || lowerPath.endsWith(".mp4");
}
