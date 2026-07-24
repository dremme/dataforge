export function parseJsonContent(
  content: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    const value = JSON.parse(content);
    if (typeof value !== "object" || value === null) {
      return { ok: false, error: "Caption JSON must be an object or array." };
    }
    return { ok: true, value };
  } catch (error) {
    const message = error instanceof SyntaxError ? error.message : "Invalid JSON.";
    return { ok: false, error: message };
  }
}
