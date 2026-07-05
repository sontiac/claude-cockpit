/**
 * Build the confirmation message shown before a window that holds live content
 * is closed and forgotten (its terminals killed and panes deleted). Returns
 * `null` when the window is empty — an empty window closes without a prompt.
 */
export function closeConfirmMessage(
  terminalCount: number,
  paneCount: number
): string | null {
  const parts: string[] = [];
  if (terminalCount > 0) {
    parts.push(`${terminalCount} terminal${terminalCount === 1 ? "" : "s"}`);
  }
  if (paneCount > 0) {
    parts.push(`${paneCount} pane${paneCount === 1 ? "" : "s"}`);
  }
  if (parts.length === 0) return null;
  return `Close this window? This will permanently close ${parts.join(
    " and "
  )} in it.`;
}
