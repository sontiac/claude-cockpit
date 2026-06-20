/**
 * Transforms a terminal's original spawn command into the command used to
 * restore it on the next launch.
 *
 * Claude terminals are restored by their exact session id so that multiple
 * sessions in the *same* folder stay distinct (a plain `--continue` would
 * collapse them all onto the most recent conversation). The id is taken from
 * whichever of `--resume <id>` / `-r <id>` / `--session-id <id>` the original
 * command carried — every Claude terminal we spawn is given one of these — and
 * re-emitted as `--resume <id>`. If no id is present (an older entry), we fall
 * back to `--continue`. Non-Claude commands are re-run as-is; an empty command
 * falls back to the default shell.
 */
export function restoreCommand(command: string): string | undefined {
  const c = command.trim();
  if (!c) return undefined;
  if (!/(^|[/\s])claude(\s|$)/.test(c)) return c;

  const id = c.match(/(?:--resume|-r|--session-id)[=\s]+([0-9a-fA-F-]{8,})/)?.[1];

  // Strip every session-selecting flag so we can append a single clean one.
  const base = c
    .replace(/\s+--session-id[=\s]+\S+/g, "")
    .replace(/\s+--resume(?:[=\s]+\S+)?/g, "")
    .replace(/\s+-r(?:[=\s]+\S+)?/g, "")
    .replace(/\s+--continue\b/g, "")
    .replace(/\s+-c\b/g, "")
    .trim();

  return id ? `${base} --resume ${id}` : `${base} --continue`;
}

/**
 * Extracts the Claude session id a terminal is bound to, from the `--resume` /
 * `-r` / `--session-id` flag in its spawn command. Every Claude terminal cockpit
 * spawns carries one of these, so this is how we map a live terminal back to its
 * session (e.g. to record a /rename against it). Returns null for shells.
 */
export function sessionIdFromCommand(command: string): string | null {
  return (
    command.match(/(?:--resume|-r|--session-id)[=\s]+([0-9a-fA-F-]{8,})/)?.[1] ??
    null
  );
}
