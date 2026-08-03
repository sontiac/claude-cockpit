/**
 * Live terminal count per project for one window. Counts terminal panes only —
 * canvas panes (notes, plan viewers, timers) have no project association.
 */
export function countTerminalsByProject(
  terminals: ReadonlyArray<{ project_id: string | null }>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of terminals) {
    if (!t.project_id) continue;
    counts.set(t.project_id, (counts.get(t.project_id) ?? 0) + 1);
  }
  return counts;
}
