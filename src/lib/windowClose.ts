/**
 * Build the confirmation message shown before a window that holds live content
 * is closed and forgotten (its terminals killed and notes deleted). Returns
 * `null` when the window is empty — an empty window closes without a prompt.
 */
export function closeConfirmMessage(
  terminalCount: number,
  noteCount: number
): string | null {
  const parts: string[] = [];
  if (terminalCount > 0) {
    parts.push(`${terminalCount} terminal${terminalCount === 1 ? "" : "s"}`);
  }
  if (noteCount > 0) {
    parts.push(`${noteCount} note${noteCount === 1 ? "" : "s"}`);
  }
  if (parts.length === 0) return null;
  return `Close this window? This will permanently close ${parts.join(
    " and "
  )} in it.`;
}
