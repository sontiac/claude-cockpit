export interface TaskProgress {
  done: number;
  total: number;
}

interface PmNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
}

function walk(node: PmNode | null | undefined, acc: TaskProgress): void {
  if (!node || typeof node !== "object") return;
  if (node.type === "taskItem") {
    acc.total++;
    if (node.attrs?.checked === true) acc.done++;
  }
  for (const child of node.content ?? []) walk(child, acc);
}

/**
 * Counts checklist completion in a ProseMirror doc (TipTap `getJSON()` output):
 * every `taskItem` node, at any nesting depth, and how many are checked.
 * Feeds the progress bar in the note toolbar.
 */
export function taskProgress(doc: unknown): TaskProgress {
  const acc: TaskProgress = { done: 0, total: 0 };
  walk(doc as PmNode | null | undefined, acc);
  return acc;
}
