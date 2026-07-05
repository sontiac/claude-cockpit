# Backlog

Small tracked items not yet scheduled. One line per item; detail lives in the
linked spec/commit when picked up.

- B1 — ContextPill shows stale token count after `/clear` in Claude (and possibly
  `/resume`): the pane appears to stay attached to the previous session's context.
  Likely the session id is resolved once at spawn and never re-resolved when Claude
  starts a new session. Reported 2026-07-05.
- B2 — usePanes arms persistence even when the initial load IPC rejects, so an
  empty pane list can overwrite the saved per-window file (pre-existing, inherited
  from useNotes; rare trigger, real data-loss consequence). Fix: arm persistence
  only after a successful load. Flagged by final review 2026-07-05.
- B3 — Batched cleanup from note-glowup final review: aria-pressed on editor
  toolbar buttons; useMarkdownFile path-change-reset test; pomodoro
  pause-after-expiry / start-at-zero tests; rename Sidebar `onNewNote` prop.
  Flagged 2026-07-05.
