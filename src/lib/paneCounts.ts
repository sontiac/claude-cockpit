import type { Pane } from "../types/pane";

// Display nouns per pane kind, in the order they appear in labels.
const KIND_NOUNS: [Pane["kind"], string][] = [
  ["terminal", "terminal"],
  ["note", "note"],
  ["mdviewer", "plan"],
  ["pomodoro", "timer"],
];

/**
 * Human label for a set of panes, broken down by kind:
 * "2 terminals · 1 note · 1 timer". Kinds with zero panes are omitted;
 * no panes at all yields "Empty".
 */
export function paneCountLabel(panes: Pick<Pane, "kind">[]): string {
  const parts = KIND_NOUNS.map(([kind, noun]) => {
    const count = panes.filter((p) => p.kind === kind).length;
    if (count === 0) return "";
    return `${count} ${noun}${count !== 1 ? "s" : ""}`;
  }).filter(Boolean);
  return parts.join(" · ") || "Empty";
}
